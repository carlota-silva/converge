import { VectorClock, type Vector } from './core/clock.js';
import { Document } from './core/document.js';
import { HEAD, idKey, type ActorId, type OpId } from './core/ids.js';
import { isOp, type JsonValue, type Op } from './core/op.js';
import type { Log } from './store/oplog.js';
import type { PeerView } from './sync/protocol.js';

export type ReceiveOutcome = 'applied' | 'buffered' | 'duplicate';

/**
 * A replica serializes edits and incoming operations. Accepted operations are
 * written to the log (including causally blocked ones) before acknowledgement.
 * Replay uses the same causal admission algorithm, with no duplicate writes.
 */
export class Replica implements PeerView {
  readonly actor: ActorId;
  readonly document = new Document();
  readonly vector = new VectorClock();
  readonly #log: Log;
  readonly #pending = new Map<string, Op>();
  readonly #applied = new Map<string, Op>();
  readonly #listeners = new Set<(op: Op) => void>();
  #lamport = 0;
  #tail: Promise<void> = Promise.resolve();

  private constructor(actor: ActorId, log: Log) {
    this.actor = actor;
    this.#log = log;
  }

  static async open(actor: ActorId, log: Log): Promise<Replica> {
    if (!actor) throw new Error('actor id must not be empty');
    await log.open();
    const replica = new Replica(actor, log);
    try {
      for (const op of await log.readAll()) {
        replica.#validate(op);
        replica.#ingest(op, false);
      }
      return replica;
    } catch (error) {
      await log.close();
      throw error;
    }
  }

  get pendingCount(): number { return this.#pending.size; }
  get appliedCount(): number { return this.#applied.size; }
  get log(): Log { return this.#log; }

  onChange(listener: (op: Op) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Preserve order even if callers do not await individual edits. */
  #serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(work, work);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  #next(): { id: OpId; deps: Vector; lamport: number } {
    const counter = this.vector.get(this.actor) + 1;
    return {
      id: { actor: this.actor, counter },
      deps: this.vector.toJSON(),
      lamport: this.#lamport + 1,
    };
  }

  #validate(op: Op): void {
    if (!isOp(op)) throw new Error('invalid operation');
    // A dense per-actor log makes vector clocks an exact statement of history.
    if ((op.deps[op.id.actor] ?? 0) !== op.id.counter - 1) {
      throw new Error(`invalid actor dependency for ${idKey(op.id)}`);
    }
  }

  #ready(op: Op): boolean {
    return this.vector.get(op.id.actor) + 1 === op.id.counter && this.vector.covers(op.deps);
  }

  #applyReady(op: Op, notify: boolean): void {
    this.document.applyOp(op);
    this.#applied.set(idKey(op.id), op);
    this.vector.observe(op.id);
    this.#lamport = Math.max(this.#lamport, op.lamport);
    if (notify) for (const listener of this.#listeners) listener(op);
  }

  #ingest(op: Op, notify: boolean): ReceiveOutcome {
    const key = idKey(op.id);
    if (this.#applied.has(key) || this.#pending.has(key)) return 'duplicate';
    if (!this.#ready(op)) {
      this.#pending.set(key, op);
      return 'buffered';
    }

    this.#applyReady(op, notify);
    let progressed: boolean;
    do {
      progressed = false;
      for (const [pendingKey, pending] of this.#pending) {
        if (!this.#ready(pending)) continue;
        this.#pending.delete(pendingKey);
        this.#applyReady(pending, notify);
        progressed = true;
      }
    } while (progressed);
    return 'applied';
  }

  async #persist(op: Op): Promise<void> {
    await this.#log.append(op);
    await this.#log.sync();
  }

  async #local(op: Op): Promise<void> {
    this.#validate(op);
    await this.#persist(op);
    if (this.#ingest(op, true) !== 'applied') {
      throw new Error('locally generated operation was not ready');
    }
  }

  async createText(field: string): Promise<void> {
    return this.#serialize(async () => {
      if (this.document.fieldKind(field) !== undefined) return;
      await this.#local({ kind: 'text.insert', ...this.#next(), field, origin: HEAD, ch: '' });
    });
  }

  async insert(field: string, index: number, text: string): Promise<void> {
    return this.#serialize(async () => {
      const chars = [...text];
      if (!chars.length) return;
      let origin = this.document.textOrThrow(field).originAt(index);
      for (const ch of chars) {
        const op: Op = { kind: 'text.insert', ...this.#next(), field, origin, ch };
        await this.#local(op);
        origin = op.id;
      }
    });
  }

  async delete(field: string, start: number, count: number): Promise<void> {
    return this.#serialize(async () => {
      const targets = this.document.textOrThrow(field).idsInRange(start, count);
      if (!targets.length) return;
      await this.#local({ kind: 'text.delete', ...this.#next(), field, targets });
    });
  }

  async set(field: string, value: JsonValue): Promise<void> {
    return this.#serialize(async () => {
      await this.#local({ kind: 'register.set', ...this.#next(), field, value });
    });
  }

  /** Accept and durably record a remote op, even if its prerequisites are missing. */
  async receive(op: Op): Promise<ReceiveOutcome> {
    return this.#serialize(async () => {
      this.#validate(op);
      const key = idKey(op.id);
      if (this.#applied.has(key) || this.#pending.has(key)) return 'duplicate';
      await this.#persist(op);
      return this.#ingest(op, true);
    });
  }

  async receiveAll(ops: readonly Op[]): Promise<Record<ReceiveOutcome, number>> {
    const tally: Record<ReceiveOutcome, number> = { applied: 0, buffered: 0, duplicate: 0 };
    for (const op of ops) tally[await this.receive(op)] += 1;
    return tally;
  }

  clock(): Vector { return this.vector.toJSON(); }
  opIds(): OpId[] { return [...this.#applied.values()].map((op) => op.id); }
  opsById(ids: readonly OpId[]): Op[] {
    const wanted = new Set(ids.map(idKey));
    return [...this.#applied].filter(([key]) => wanted.has(key)).map(([, op]) => op);
  }
  isReady(op: Op): boolean {
    const key = idKey(op.id);
    return !this.#applied.has(key) && !this.#pending.has(key) && this.#ready(op);
  }
}

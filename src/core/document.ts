import { compareIds, type ActorId } from './ids.js';
import { Rga } from './rga.js';
import type { JsonValue, Op } from './op.js';

interface Register {
  value: JsonValue;
  lamport: number;
  actor: ActorId;
}

export type FieldKind = 'register' | 'text';

/** Document: LWW registers for metadata, RGAs for text bodies. */
export class Document {
  readonly #kinds = new Map<string, FieldKind>();
  readonly #registers = new Map<string, Register>();
  readonly #texts = new Map<string, Rga>();

  fieldKind(field: string): FieldKind | undefined {
    return this.#kinds.get(field);
  }

  #claim(field: string, kind: FieldKind): void {
    const existing = this.#kinds.get(field);
    if (existing === undefined) {
      this.#kinds.set(field, kind);
      return;
    }
    if (existing !== kind) {
      throw new Error(`field ${field} is ${existing}, not ${kind}`);
    }
  }

  register(field: string): JsonValue | undefined {
    return this.#registers.get(field)?.value;
  }

  text(field: string): string {
    return this.#texts.get(field)?.toString() ?? '';
  }

  textOrThrow(field: string): Rga {
    const rga = this.#texts.get(field);
    if (rga === undefined) throw new Error(`no text field ${field}`);
    return rga;
  }

  applyOp(op: Op): void {
    switch (op.kind) {
      case 'register.set': {
        this.#claim(op.field, 'register');
        const current = this.#registers.get(op.field);
        const next: Register = { value: op.value, lamport: op.lamport, actor: op.id.actor };
        if (current === undefined || this.#wins(next, current)) {
          this.#registers.set(op.field, next);
        }
        return;
      }
      case 'text.insert': {
        this.#claim(op.field, 'text');
        let rga = this.#texts.get(op.field);
        if (rga === undefined) {
          rga = new Rga();
          this.#texts.set(op.field, rga);
        }
        rga.insert(op.id, op.origin, op.ch);
        return;
      }
      case 'text.delete': {
        this.#claim(op.field, 'text');
        this.#texts.get(op.field)?.remove(op.targets);
        return;
      }
    }
  }

  #wins(next: Register, current: Register): boolean {
    return compareIds({ actor: next.actor, counter: next.lamport }, { actor: current.actor, counter: current.lamport }) > 0;
  }

  toJSON(): Record<string, JsonValue> {
    const out: Record<string, JsonValue> = {};
    for (const [field, register] of this.#registers) out[field] = register.value;
    for (const [field, rga] of this.#texts) out[field] = rga.toString();
    return out;
  }

  serialize(): SerializedDocument {
    return {
      kinds: [...this.#kinds],
      registers: [...this.#registers].map(([field, register]) => [field, register]),
      texts: [...this.#texts].map(([field, rga]) => [field, rga.serialize()]),
    };
  }

  static deserialize(state: SerializedDocument): Document {
    const doc = new Document();
    for (const [field, kind] of state.kinds) doc.#kinds.set(field, kind);
    for (const [field, register] of state.registers) doc.#registers.set(field, register);
    for (const [field, elements] of state.texts) doc.#texts.set(field, Rga.deserialize(elements));
    return doc;
  }
}

export interface SerializedDocument {
  kinds: [string, FieldKind][];
  registers: [string, Register][];
  texts: [string, ReturnType<Rga['serialize']>][];
}

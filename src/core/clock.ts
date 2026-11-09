import type { ActorId, OpId } from './ids.js';

export type Vector = Record<ActorId, number>;

/** Vector clock: per-actor counters, used only for causal readiness. */
export class VectorClock {
  readonly #counters = new Map<ActorId, number>();

  get(actor: ActorId): number {
    return this.#counters.get(actor) ?? 0;
  }

  /** Advance to at least `counter` for `actor`. Returns true if it grew. */
  observe(id: OpId): boolean {
    const current = this.get(id.actor);
    if (current >= id.counter) return false;
    this.#counters.set(id.actor, id.counter);
    return true;
  }

  merge(other: Vector): void {
    for (const [actor, counter] of Object.entries(other)) {
      if (counter > this.get(actor)) this.#counters.set(actor, counter);
    }
  }

  /** True when every dependency in `deps` has been observed. */
  covers(deps: Vector): boolean {
    for (const [actor, counter] of Object.entries(deps)) {
      if (this.get(actor) < counter) return false;
    }
    return true;
  }

  toJSON(): Vector {
    return Object.fromEntries(this.#counters);
  }

  static fromJSON(vector: Vector): VectorClock {
    const clock = new VectorClock();
    clock.merge(vector);
    return clock;
  }
}

export function isVector(value: unknown): value is Vector {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value as Record<string, unknown>).every(
    (counter) => typeof counter === 'number' && Number.isSafeInteger(counter) && counter >= 0,
  );
}

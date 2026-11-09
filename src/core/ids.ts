export type ActorId = string;

export interface OpId {
  readonly actor: ActorId;
  readonly counter: number;
}

/** Sentinel origin meaning "before the first element". */
export const HEAD: OpId = Object.freeze({ actor: '', counter: 0 });

/** Total order on ids: Lamport counter first, then actor. */
export function compareIds(a: OpId, b: OpId): number {
  if (a.counter !== b.counter) return a.counter > b.counter ? 1 : -1;
  if (a.actor === b.actor) return 0;
  return a.actor > b.actor ? 1 : -1;
}

export function idKey(id: OpId): string {
  return `${id.counter}@${id.actor}`;
}

export function parseIdKey(key: string): OpId {
  const at = key.indexOf('@');
  if (at < 1) throw new Error(`malformed op id: ${key}`);
  const counter = Number(key.slice(0, at));
  const actor = key.slice(at + 1);
  if (!Number.isSafeInteger(counter) || counter < 1 || actor === '') {
    throw new Error(`malformed op id: ${key}`);
  }
  return { actor, counter };
}

export function isOpId(value: unknown): value is OpId {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['actor'] === 'string' &&
    candidate['actor'] !== '' &&
    typeof candidate['counter'] === 'number' &&
    Number.isSafeInteger(candidate['counter']) &&
    candidate['counter'] >= 1
  );
}

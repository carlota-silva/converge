import { HEAD, isOpId, type OpId } from './ids.js';
import { isVector, type Vector } from './clock.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface BaseOp {
  readonly id: OpId;
  readonly lamport: number;
  readonly deps: Vector;
  readonly field: string;
}

export interface RegisterSetOp extends BaseOp {
  readonly kind: 'register.set';
  readonly value: JsonValue;
}

export interface TextInsertOp extends BaseOp {
  readonly kind: 'text.insert';
  readonly origin: OpId;
  /** Exactly one code point, or empty for the field-declaring marker. */
  readonly ch: string;
}

export interface TextDeleteOp extends BaseOp {
  readonly kind: 'text.delete';
  readonly targets: readonly OpId[];
}

export type Op = RegisterSetOp | TextInsertOp | TextDeleteOp;
export type OpKind = Op['kind'];

export function isOp(value: unknown): value is Op {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['field'] !== 'string' || candidate['field'] === '') return false;
  if (!isOpId(candidate['id']) || !isVector(candidate['deps'])) return false;
  if (typeof candidate['lamport'] !== 'number' || !Number.isSafeInteger(candidate['lamport']) || candidate['lamport'] < 1) return false;

  switch (candidate['kind']) {
    case 'register.set':
      return 'value' in candidate;
    case 'text.insert': {
      const ch = candidate['ch'];
      return (isOpId(candidate['origin']) || isHead(candidate['origin'])) && typeof ch === 'string' && [...ch].length <= 1;
    }
    case 'text.delete':
      return Array.isArray(candidate['targets']) && candidate['targets'].every(isOpId);
    default:
      return false;
  }
}

export function decodeOps(payload: unknown): Op[] {
  if (!Array.isArray(payload)) throw new Error('expected an array of operations');
  return payload.map((entry, index) => {
    if (!isOp(entry)) throw new Error(`operation ${index} failed validation`);
    return entry;
  });
}

function isHead(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const id = value as Record<string, unknown>;
  return id['actor'] === HEAD.actor && id['counter'] === HEAD.counter;
}

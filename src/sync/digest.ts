const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export interface SerializedDigest {
  m: number;
  k: number;
  bits: string;
}

const MIN_BITS = 64;
const MAX_BITS = 1 << 22;

/**
 * Bloom filter over operation identifiers.
 *
 * False positives make a peer skip a missing operation for one round; they never
 * corrupt state. False negatives are impossible.
 */
export class Digest {
  readonly m: number;
  readonly k: number;
  readonly #bits: Uint8Array;

  constructor(m: number, k: number, bits?: Uint8Array) {
    if (!Number.isInteger(m) || m < MIN_BITS || m > MAX_BITS) throw new Error(`bad bit count ${m}`);
    if (!Number.isInteger(k) || k < 1 || k > 16) throw new Error(`bad hash count ${k}`);
    this.m = m;
    this.k = k;
    this.#bits = bits ?? new Uint8Array(Math.ceil(m / 8));
  }

  static sized(expected: number, falsePositiveRate = 0.01): Digest {
    const m = Math.max(MIN_BITS, Math.ceil((-expected * Math.log(falsePositiveRate)) / Math.LN2 ** 2));
    const k = Math.max(1, Math.round((m / Math.max(expected, 1)) * Math.LN2));
    return new Digest(Math.min(m, MAX_BITS), Math.min(k, 16));
  }

  #positions(key: string): number[] {
    const first = fnv1a(key);
    const second = fnv1a(`${key}\u0000`) | 1;
    const positions: number[] = [];
    for (let i = 0; i < this.k; i += 1) {
      positions.push(((first + Math.imul(i, second)) >>> 0) % this.m);
    }
    return positions;
  }

  add(key: string): void {
    for (const position of this.#positions(key)) {
      this.#bits[position >> 3]! |= 1 << (position & 7);
    }
  }

  has(key: string): boolean {
    return this.#positions(key).every((position) => (this.#bits[position >> 3]! & (1 << (position & 7))) !== 0);
  }

  toJSON(): SerializedDigest {
    return { m: this.m, k: this.k, bits: Buffer.from(this.#bits).toString('base64') };
  }

  static fromJSON(digest: SerializedDigest): Digest {
    if (typeof digest !== 'object' || digest === null || typeof digest.bits !== 'string' ||
        !Number.isInteger(digest.m) || !Number.isInteger(digest.k)) {
      throw new Error('malformed digest');
    }
    const bits = new Uint8Array(Buffer.from(digest.bits, 'base64'));
    if (bits.length !== Math.ceil(digest.m / 8)) throw new Error('invalid digest length');
    return new Digest(digest.m, digest.k, bits);
  }
}

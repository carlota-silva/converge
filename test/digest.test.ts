import { describe, expect, it } from 'vitest';
import { Digest } from '../src/sync/digest.js';

describe('Digest', () => {
  it('has no false negatives', () => {
    const digest = Digest.sized(1000);
    const keys = Array.from({ length: 1000 }, (_, i) => `op-${i}`);
    for (const key of keys) digest.add(key);
    for (const key of keys) expect(digest.has(key)).toBe(true);
  });

  it('reports absent keys as mostly absent', () => {
    const digest = Digest.sized(1000, 0.01);
    for (let i = 0; i < 1000; i += 1) digest.add(`op-${i}`);

    let hits = 0;
    for (let i = 0; i < 2000; i += 1) if (digest.has(`absent-${i}`)) hits += 1;
    expect(hits / 2000).toBeLessThan(0.05);
  });

  it('round-trips through JSON', () => {
    const digest = Digest.sized(50);
    digest.add('a');
    const restored = Digest.fromJSON(digest.toJSON());
    expect(restored.has('a')).toBe(true);
    expect(restored.has('b')).toBe(false);
  });

  it('rejects out-of-range parameters', () => {
    expect(() => new Digest(4, 3)).toThrow(/bit count/);
    expect(() => new Digest(1024, 0)).toThrow(/hash count/);
  });
});

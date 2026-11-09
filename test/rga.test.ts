import { describe, expect, it } from 'vitest';
import { Rga } from '../src/core/rga.js';
import { HEAD, type OpId } from '../src/core/ids.js';

const id = (counter: number, actor = 'a'): OpId => ({ counter, actor });

function build(pairs: [OpId, OpId, string][]): Rga {
  const rga = new Rga();
  for (const [self, origin, ch] of pairs) rga.insert(self, origin, ch);
  return rga;
}

describe('Rga', () => {
  it('appends in origin order', () => {
    const a = id(1);
    const b = id(2);
    const rga = build([
      [a, HEAD, 'x'],
      [b, a, 'y'],
    ]);
    expect(rga.toString()).toBe('xy');
  });

  it('orders concurrent siblings by descending lamport id regardless of arrival', () => {
    const origin = id(1);
    const left = build([
      [origin, HEAD, '_'],
      [id(3, 'a'), origin, 'A'],
      [id(3, 'b'), origin, 'B'],
    ]);
    const right = build([
      [origin, HEAD, '_'],
      [id(3, 'b'), origin, 'B'],
      [id(3, 'a'), origin, 'A'],
    ]);
    expect(left.toString()).toBe(right.toString());
    expect(left.toString()).toBe('_BA');
  });

  it('keeps a child attached to its parent across interleaving', () => {
    const origin = id(1);
    const rga = build([
      [origin, HEAD, '_'],
      [id(2, 'a'), origin, 'A'],
      [id(2, 'b'), origin, 'B'],
      [id(3, 'a'), id(2, 'a'), 'a2'],
    ]);
    expect(rga.toString()).toBe('_BAa2');
  });

  it('tombstones without shifting neighbours', () => {
    const a = id(1);
    const b = id(2);
    const c = id(3);
    const rga = build([
      [a, HEAD, 'a'],
      [b, a, 'b'],
      [c, b, 'c'],
    ]);
    rga.remove([b]);
    expect(rga.toString()).toBe('ac');
    expect(rga.length).toBe(2);
    expect(rga.size).toBe(3);
  });

  it('is idempotent on reinsert', () => {
    const a = id(1);
    const rga = build([[a, HEAD, 'a']]);
    rga.insert(a, HEAD, 'a');
    expect(rga.toString()).toBe('a');
  });

  it('throws when the origin is unknown', () => {
    expect(() => new Rga().insert(id(5), id(4), 'x')).toThrow(/unknown origin/);
  });

  it('resolves an insert index to the preceding visible id', () => {
    const a = id(1);
    const b = id(2);
    const rga = build([
      [a, HEAD, 'a'],
      [b, a, 'b'],
    ]);
    expect(rga.originAt(0)).toBe(HEAD);
    expect(rga.originAt(1)).toBe(a);
    expect(rga.originAt(2)).toBe(b);
    expect(() => rga.originAt(3)).toThrow(/out of range/);
  });

  it('round-trips through serialization', () => {
    const rga = build([
      [id(1), HEAD, 'a'],
      [id(2), id(1), 'b'],
    ]);
    rga.remove([id(1)]);
    expect(Rga.deserialize(rga.serialize()).toString()).toBe('b');
  });
});

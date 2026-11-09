import { describe, expect, it } from 'vitest';
import { VectorClock } from '../src/core/clock.js';

describe('VectorClock', () => {
  it('covers its own history', () => {
    const clock = new VectorClock();
    clock.observe({ actor: 'a', counter: 1 });
    expect(clock.covers({ a: 1 })).toBe(true);
    expect(clock.covers({ a: 2 })).toBe(false);
  });

  it('does not cover an unobserved actor', () => {
    expect(new VectorClock().covers({ b: 1 })).toBe(false);
  });

  it('treats an empty dependency set as covered', () => {
    expect(new VectorClock().covers({})).toBe(true);
  });

  it('merges to the pointwise maximum', () => {
    const clock = VectorClock.fromJSON({ a: 2, b: 5 });
    clock.merge({ a: 4, b: 1, c: 3 });
    expect(clock.toJSON()).toEqual({ a: 4, b: 5, c: 3 });
  });

  it('reports whether observe advanced', () => {
    const clock = new VectorClock();
    expect(clock.observe({ actor: 'a', counter: 3 })).toBe(true);
    expect(clock.observe({ actor: 'a', counter: 2 })).toBe(false);
  });
});

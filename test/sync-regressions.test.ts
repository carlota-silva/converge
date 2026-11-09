import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { Rga } from '../src/core/rga.js';
import { HEAD } from '../src/core/ids.js';
import { Replica } from '../src/replica.js';
import { MemoryLog } from '../src/store/memory-log.js';
import { Digest } from '../src/sync/digest.js';
import { computeMissing } from '../src/sync/protocol.js';
import { serve } from '../src/sync/server.js';
import { sync } from '../src/sync/client.js';

describe('merge and sync regressions', () => {
  it('keeps a concurrent sibling after the entire older subtree', () => {
    const origin = { actor: 'a', counter: 1 };
    const older = { actor: 'b', counter: 5 };
    const child = { actor: 'b', counter: 6 };
    const newerSibling = { actor: 'c', counter: 4 };
    const rga = new Rga();
    rga.insert(origin, HEAD, '_');
    rga.insert(older, origin, 'B');
    rga.insert(child, older, 'b');
    rga.insert(newerSibling, origin, 'A');
    expect(rga.toString()).toBe('_BbA');
  });

  it('uses logical Lamport timestamps, not local actor counters for LWW', async () => {
    const a = await Replica.open('a', new MemoryLog());
    const b = await Replica.open('b', new MemoryLog());
    for (let n = 0; n < 8; n++) await a.set('title', `${n}`);
    await b.receiveAll((a.log as MemoryLog).ops);
    await b.set('title', 'later');
    await a.receiveAll((b.log as MemoryLog).ops);
    expect(a.document.register('title')).toBe('later');
  });

  it('does not skip operations because a Bloom filter lies', async () => {
    const a = await Replica.open('a', new MemoryLog());
    const b = await Replica.open('b', new MemoryLog());
    await a.set('title', 'hello');
    const allOnes = new Digest(64, 2);
    for (let n = 0; n < 10_000; n++) allOnes.add(`random-${n}`);
    expect(computeMissing(a, b.clock(), allOnes.toJSON())).toHaveLength(1);
  });

  it('sends both parties edits in a single HTTP sync session', async () => {
    const a = await Replica.open('a', new MemoryLog());
    const b = await Replica.open('b', new MemoryLog());
    await a.set('author-a', 1);
    await b.set('author-b', 2);
    const server = serve({ peer: b, onOps: (ops) => b.receiveAll(ops) });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected TCP address');
      const result = await sync(`http://127.0.0.1:${address.port}`, a, (ops) => a.receiveAll(ops));
      expect(result.sent).toBeGreaterThan(0);
      expect(result.received).toBeGreaterThan(0);
      expect(a.document.toJSON()).toEqual(b.document.toJSON());
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

import { describe, expect, it } from 'vitest';
import { Replica } from '../src/replica.js';
import { MemoryLog } from '../src/store/memory-log.js';
import { sync } from '../src/sync/client.js';
import { serve } from '../src/sync/server.js';
import { computeMissing, localDigest } from '../src/sync/protocol.js';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

async function pair(): Promise<{ a: Replica; b: Replica; url: string; close(): Promise<void> }> {
  const a = await Replica.open('a', new MemoryLog());
  const b = await Replica.open('b', new MemoryLog());
  const server: Server = serve({ peer: b, onOps: (ops) => b.receiveAll(ops) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    a,
    b,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('sync protocol', () => {
  it('converges two divergent replicas', async () => {
    const { a, b, url, close } = await pair();
    try {
      await a.createText('body');
      await b.createText('body');
      await a.insert('body', 0, 'from a ');
      await b.insert('body', 0, 'from b ');

      const result = await sync(url, a, (ops) => a.receiveAll(ops));
      expect(result.received).toBeGreaterThan(0);
      expect(a.document.toJSON()).toEqual(b.document.toJSON());
      expect(a.pendingCount).toBe(0);
      expect(b.pendingCount).toBe(0);
    } finally {
      await close();
    }
  });

  it('settles immediately when already in sync', async () => {
    const { a, b, url, close } = await pair();
    try {
      await a.createText('body');
      await a.insert('body', 0, 'x');
      await b.receiveAll((a.log as MemoryLog).ops);

      const result = await sync(url, a, (ops) => a.receiveAll(ops));
      expect(result.rounds).toBe(1);
      expect(result.sent).toBe(0);
      expect(result.received).toBe(0);
    } finally {
      await close();
    }
  });

  it('asks only for operations outside the remote clock and digest', async () => {
    const a = await Replica.open('a', new MemoryLog());
    await a.createText('body');
    await a.insert('body', 0, 'abc');

    const empty = await Replica.open('empty', new MemoryLog());
    const missing = computeMissing(a, empty.clock(), localDigest(empty));
    expect(missing).toHaveLength(4);
  });

  it('rejects a malformed body', async () => {
    const { url, close } = await pair();
    try {
      const response = await fetch(`${url}/sync`, { method: 'POST', body: '{"clock":{}}' });
      expect(response.status).toBe(400);
    } finally {
      await close();
    }
  });
});

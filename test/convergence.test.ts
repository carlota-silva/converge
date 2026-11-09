import { describe, expect, it } from 'vitest';
import { Replica } from '../src/replica.js';
import { MemoryLog } from '../src/store/memory-log.js';
import type { Op } from '../src/core/op.js';

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

const ALPHABET = 'abcdefghij ';

async function edit(replica: Replica, random: () => number, steps: number): Promise<void> {
  for (let step = 0; step < steps; step += 1) {
    const length = replica.document.text('body').length;
    const roll = random();

    if (roll < 0.55) {
      const at = Math.floor(random() * (length + 1));
      const ch = ALPHABET[Math.floor(random() * ALPHABET.length)]!;
      await replica.insert('body', at, ch);
    } else if (roll < 0.8 && length > 0) {
      await replica.delete('body', Math.floor(random() * length), 1 + Math.floor(random() * 2));
    } else {
      await replica.set('title', `rev-${Math.floor(random() * 100)}`);
    }
  }
}

describe('convergence', () => {
  for (const seed of [1, 7, 42, 1337, 90210]) {
    it(`converges under shuffled delivery (seed ${seed})`, async () => {
      const random = mulberry32(seed);
      const actors = ['alpha', 'beta', 'gamma'];
      const replicas: Replica[] = [];

      for (const actor of actors) {
        const replica = await Replica.open(actor, new MemoryLog());
        await replica.createText('body');
        replicas.push(replica);
      }

      // Each replica edits in isolation, so their histories diverge.
      for (const replica of replicas) await edit(replica, random, 40);

      const all: Op[] = replicas.flatMap((replica) => (replica.log as MemoryLog).ops);
      const observer = await Replica.open('observer', new MemoryLog());
      await observer.receiveAll(shuffle(all, random));
      for (const replica of replicas) await replica.receiveAll(shuffle(all, random));

      for (const replica of replicas) {
        expect(replica.document.toJSON()).toEqual(observer.document.toJSON());
        expect(replica.pendingCount).toBe(0);
      }
      expect(observer.pendingCount).toBe(0);
    });
  }

  it('is idempotent under duplicated delivery', async () => {
    const a = await Replica.open('a', new MemoryLog());
    const b = await Replica.open('b', new MemoryLog());
    await a.createText('body');
    await b.createText('body');
    await a.insert('body', 0, 'abc');
    await b.insert('body', 0, 'xyz');

    const ops = [...(a.log as MemoryLog).ops, ...(b.log as MemoryLog).ops];
    const once = await Replica.open('once', new MemoryLog());
    await once.receiveAll(ops);
    const twice = await Replica.open('twice', new MemoryLog());
    await twice.receiveAll([...ops, ...ops, ...ops]);

    expect(twice.document.toJSON()).toEqual(once.document.toJSON());
  });

  it('buffers an operation whose dependency is missing', async () => {
    const a = await Replica.open('a', new MemoryLog());
    await a.createText('body');
    await a.insert('body', 0, 'hi');
    const ops = (a.log as MemoryLog).ops;

    const b = await Replica.open('b', new MemoryLog());
    const [marker, first] = ops;
    expect(await b.receive(first!)).toBe('buffered');
    expect(b.pendingCount).toBe(1);
    expect(await b.receive(marker!)).toBe('applied');
    expect(b.pendingCount).toBe(0);
    expect(b.document.text('body')).toBe('h');
  });

  it('registers resolve to the highest lamport write', async () => {
    const a = await Replica.open('a', new MemoryLog());
    const b = await Replica.open('b', new MemoryLog());
    await a.set('title', 'a');
    await b.receiveAll((a.log as MemoryLog).ops);
    await b.set('title', 'b'); // observed a's write, so higher lamport

    await a.receiveAll((b.log as MemoryLog).ops);
    expect(a.document.register('title')).toBe('b');
    expect(b.document.register('title')).toBe('b');
  });
});

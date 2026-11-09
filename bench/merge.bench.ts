import { bench, describe } from 'vitest';
import { Rga } from '../src/core/rga.js';
import { HEAD, type OpId } from '../src/core/ids.js';
import { Replica } from '../src/replica.js';
import { MemoryLog } from '../src/store/memory-log.js';

function seeded(length: number): Rga {
  const rga = new Rga();
  let origin: OpId = HEAD;
  for (let i = 0; i < length; i += 1) {
    const id: OpId = { actor: 'a', counter: i + 1 };
    rga.insert(id, origin, 'x');
    origin = id;
  }
  return rga;
}

describe('rga append', () => {
  for (const size of [100, 1000, 10000]) {
    bench(`append into ${size} chars`, () => {
      const rga = seeded(size);
      rga.insert({ actor: 'b', counter: size + 1 }, HEAD, 'y');
    });
  }
});

describe('divergence and merge', () => {
  bench('2 replicas x 100 ops', async () => {
    const a = await Replica.open('a', new MemoryLog());
    const b = await Replica.open('b', new MemoryLog());
    await a.createText('body');
    await b.createText('body');
    for (let i = 0; i < 100; i += 1) {
      await a.insert('body', 0, 'a');
      await b.insert('body', 0, 'b');
    }
    await a.receiveAll((b.log as MemoryLog).ops);
  });
});

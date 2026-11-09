/** Standalone integration checks for a built project: node scripts/smoke-test.mjs */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Replica, MemoryLog, OpLog, Rga, HEAD, Digest, serve, sync } from '../dist/index.js';
import { computeMissing, localDigest } from '../dist/sync/protocol.js';

let total = 0;
async function check(name, task) {
  await task();
  console.log(`✓ ${name}`);
  total++;
}
const open = (actor) => Replica.open(actor, new MemoryLog());
const doc = (r) => r.document.toJSON();

await check('RGA concurrent sibling ordering includes the full preceding subtree', async () => {
  const root = { actor: 'r', counter: 1 };
  const newer = { actor: 'b', counter: 5 };
  const older = { actor: 'a', counter: 4 };
  const child = { actor: 'b', counter: 6 };
  const first = new Rga();
  first.insert(root, HEAD, '_');
  first.insert(newer, root, 'B');
  first.insert(child, newer, 'b');
  first.insert(older, root, 'A');
  const second = new Rga();
  second.insert(root, HEAD, '_');
  second.insert(older, root, 'A');
  second.insert(newer, root, 'B');
  second.insert(child, newer, 'b');
  assert.equal(first.toString(), '_BbA');
  assert.equal(first.toString(), second.toString());
});

await check('Out-of-order operations remain durable across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'converge-pending-'));
  try {
    const source = await open('source');
    await source.createText('body');
    await source.insert('body', 0, 'ok');
    const ops = source.log.ops;
    const destPath = join(dir, 'dest.log');
    const dest = await Replica.open('dest', new OpLog(destPath));
    assert.equal(await dest.receive(ops[2]), 'buffered');
    await dest.log.close();
    const reopened = await Replica.open('dest', new OpLog(destPath));
    assert.equal(reopened.pendingCount, 1);
    await reopened.receive(ops[0]);
    await reopened.receive(ops[1]);
    assert.equal(reopened.document.text('body'), 'ok');
    await reopened.log.close();
    const final = await Replica.open('dest', new OpLog(destPath));
    assert.equal(final.document.text('body'), 'ok');
    assert.equal(final.pendingCount, 0);
    await final.log.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await check('Duplication does not create extra log records', async () => {
  const a = await open('a');
  const b = await open('b');
  await a.createText('body');
  await a.insert('body', 0, 'x');
  await b.receiveAll(a.log.ops);
  const before = b.log.ops.length;
  await b.receiveAll(a.log.ops);
  assert.equal(b.log.ops.length, before);
});

await check('Dependent LWW update wins despite lower actor sequence counter', async () => {
  const a = await open('a');
  const b = await open('b');
  for (let i = 0; i < 8; i++) await a.set('title', `a-${i}`);
  await b.receiveAll(a.log.ops);
  await b.set('title', 'observed-update');
  await a.receiveAll(b.log.ops);
  assert.equal(a.document.register('title'), 'observed-update');
  assert.equal(b.document.register('title'), 'observed-update');
});

await check('Concurrent, unawaited local calls are serialized', async () => {
  const r = await open('a');
  await r.createText('body');
  await Promise.all(Array.from({ length: 15 }, (_, i) => r.set('counter', i)));
  assert.equal(r.document.register('counter'), 14);
  assert.equal(r.appliedCount, 16);
});

await check('Two-way HTTP sync transfers edits in both directions', async () => {
  const a = await open('a');
  const b = await open('b');
  await a.createText('body');
  await b.createText('body');
  await a.insert('body', 0, 'alice');
  await b.insert('body', 0, 'bob');
  const server = serve({ peer: b, onOps: (ops) => b.receiveAll(ops) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const result = await sync(url, a, (ops) => a.receiveAll(ops));
    assert.ok(result.sent > 0, 'A did not push');
    assert.ok(result.received > 0, 'A did not pull');
    assert.deepEqual(doc(a), doc(b));
    assert.equal(a.pendingCount, 0);
    assert.equal(b.pendingCount, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

await check('A Bloom false positive cannot suppress missing operations', async () => {
  const a = await open('a');
  const b = await open('b');
  await a.set('title', 'hello');
  const allOnes = new Digest(64, 2);
  for (let i = 0; i < 10_000; i++) allOnes.add(`key${i}`);
  const missing = computeMissing(a, b.clock(), allOnes.toJSON());
  assert.equal(missing.length, 1);
  assert.equal(localDigest(a).m >= 64, true);
});

await check('Malformed Bloom digest is rejected', async () => {
  const a = await open('a');
  assert.throws(() => computeMissing(a, {}, { m: 64, k: 2, bits: 'AA==' }), /length/);
});

await check('Complete corrupt last log record is rejected; torn JSON tail is ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'converge-log-'));
  try {
    const path = join(dir, 'test.log');
    const r = await Replica.open('a', new OpLog(path));
    await r.set('x', 'ok');
    await r.log.close();
    await appendFile(path, '{"broken":true}\n');
    await assert.rejects(Replica.open('a', new OpLog(path)), /corrupt log at line 2/);
    const raw = await readFile(path, 'utf8');
    await writeFile(path, raw.split('\n')[0] + '\n' + '{"kind":"');
    const reopened = await Replica.open('a', new OpLog(path));
    assert.equal(reopened.document.register('x'), 'ok');
    await reopened.set('y', 'after-tail-recovery');
    await reopened.log.close();
    const afterAppend = await Replica.open('a', new OpLog(path));
    assert.equal(afterAppend.document.register('y'), 'after-tail-recovery');
    await afterAppend.log.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function mulberry32(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(values, random) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
await check('100 seeded offline convergence runs with arbitrary delivery order', async () => {
  for (let seed = 1; seed <= 100; seed++) {
    const random = mulberry32(seed);
    const replicas = await Promise.all(['a', 'b', 'c'].map(open));
    for (const r of replicas) {
      await r.createText('body');
      for (let i = 0; i < 30; i++) {
        const length = r.document.text('body').length;
        if (length > 0 && random() < 0.3) {
          await r.delete('body', Math.floor(random() * length), 1);
        } else {
          const at = Math.floor(random() * (length + 1));
          await r.insert('body', at, 'abc'[Math.floor(random() * 3)]);
        }
      }
    }
    const all = replicas.flatMap((r) => r.log.ops);
    const observer = await open('observer');
    await observer.receiveAll(shuffled(all, random));
    assert.equal(observer.pendingCount, 0, `observer pending seed ${seed}`);
    for (const r of replicas) {
      await r.receiveAll(shuffled(all, random));
      assert.deepEqual(doc(r), doc(observer), `divergent seed ${seed}`);
      assert.equal(r.pendingCount, 0, `pending seed ${seed}`);
    }
  }
});

console.log(`\n${total} integration checks passed.`);

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpLog } from '../src/store/oplog.js';
import { MemoryLog } from '../src/store/memory-log.js';
import { Replica } from '../src/replica.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('durability regressions', () => {
  it('replays buffered ops received before their dependencies across two restarts', async () => {
    const sender = await Replica.open('a', new MemoryLog());
    await sender.createText('body');
    await sender.insert('body', 0, 'ok');
    const [marker, first, second] = (sender.log as MemoryLog).ops;
    const dir = await mkdtemp(join(tmpdir(), 'converge-'));
    dirs.push(dir);
    const path = join(dir, 'receiver.log');
    const receiver = await Replica.open('b', new OpLog(path));
    expect(await receiver.receive(second!)).toBe('buffered');
    await receiver.log.close();

    const reopened = await Replica.open('b', new OpLog(path));
    expect(reopened.pendingCount).toBe(1);
    await reopened.receive(marker!);
    await reopened.receive(first!);
    expect(reopened.document.text('body')).toBe('ok');
    await reopened.log.close();

    const final = await Replica.open('b', new OpLog(path));
    expect(final.document.text('body')).toBe('ok');
    expect(final.pendingCount).toBe(0);
    await final.log.close();
  });

  it('never silently discards a fully written malformed final operation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'converge-'));
    dirs.push(dir);
    const path = join(dir, 'corrupt.log');
    const log = new OpLog(path);
    const r = await Replica.open('a', log);
    await r.set('title', 'yes');
    await r.log.close();
    await appendFile(path, '{"not":"an operation"}\n');
    await expect(Replica.open('a', new OpLog(path))).rejects.toThrow(/corrupt log at line 2/);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpLog } from '../src/store/oplog.js';
import { Replica } from '../src/replica.js';
import { MemoryLog } from '../src/store/memory-log.js';

let dir: string | null = null;

async function tempLog(): Promise<OpLog> {
  dir ??= await mkdtemp(join(tmpdir(), 'converge-test-'));
  return new OpLog(join(dir, `log-${Math.random().toString(36).slice(2)}.log`));
}

afterEach(() => {
  dir = null;
});

describe('OpLog', () => {
  it('replays what it wrote', async () => {
    const log = await tempLog();
    const replica = await Replica.open('a', log);
    await replica.createText('body');
    await replica.insert('body', 0, 'hey');
    await log.close();

    const reopened = await Replica.open('a', new OpLog(log.path));
    expect(reopened.document.text('body')).toBe('hey');
    expect(reopened.appliedCount).toBe(4);
  });

  it('drops a torn final line', async () => {
    const log = await tempLog();
    const replica = await Replica.open('a', log);
    await replica.createText('body');
    await replica.insert('body', 0, 'ok');
    await log.close();

    await appendFile(log.path, '{"kind":"text.insert","id":{"act');
    const reopened = await Replica.open('a', new OpLog(log.path));
    expect(reopened.document.text('body')).toBe('ok');
  });

  it('rejects corruption in the middle', async () => {
    const log = await tempLog();
    const replica = await Replica.open('a', log);
    await replica.createText('body');
    await replica.insert('body', 0, 'ok');
    await log.close();

    const lines = (await (await import('node:fs/promises')).readFile(log.path, 'utf8')).split('\n');
    lines[1] = '{"broken":true}';
    await writeFile(log.path, lines.join('\n'));

    await expect(Replica.open('a', new OpLog(log.path))).rejects.toThrow(/corrupt log at line 2/);
  });

  it('returns an empty replay for a missing file', async () => {
    const log = new OpLog(join(tmpdir(), 'converge-missing', 'nope.log'));
    expect(await log.readAll()).toEqual([]);
  });

  it('rewrites the log in place', async () => {
    const log = await tempLog();
    const replica = await Replica.open('a', log);
    await replica.createText('body');
    await log.rewrite([]);
    expect(await log.readAll()).toEqual([]);
  });
});

describe('MemoryLog', () => {
  it('refuses appends before open', async () => {
    const log = new MemoryLog();
    await expect(log.append({} as never)).rejects.toThrow(/not open/);
  });
});

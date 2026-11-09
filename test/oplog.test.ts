import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpLog } from '../src/store/oplog.js';
import { Replica } from '../src/replica.js';
import { MemoryLog } from '../src/store/memory-log.js';

const tempDirs: string[] = [];
const openedLogs: OpLog[] = [];

function trackedLog(path: string): OpLog {
  const log = new OpLog(path);
  openedLogs.push(log);
  return log;
}

async function tempLog(): Promise<OpLog> {
  const dir = await mkdtemp(join(tmpdir(), 'converge-test-'));
  tempDirs.push(dir);
  return trackedLog(join(dir, 'log.jsonl'));
}

afterEach(async () => {
  // Node 26 treats forgotten open FileHandles as uncaught exceptions. Close
  // each handle (including reopened replicas) before removing temp files.
  await Promise.all(openedLogs.splice(0).map((log) => log.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('OpLog', () => {
  it('replays what it wrote', async () => {
    const log = await tempLog();
    const replica = await Replica.open('a', log);
    await replica.createText('body');
    await replica.insert('body', 0, 'hey');
    await log.close();

    const reopened = await Replica.open('a', trackedLog(log.path));
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
    const reopened = await Replica.open('a', trackedLog(log.path));
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

    await expect(Replica.open('a', trackedLog(log.path))).rejects.toThrow(/corrupt log at line 2/);
  });

  it('returns an empty replay for a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'converge-missing-'));
    tempDirs.push(dir);
    const log = trackedLog(join(dir, 'absent.log'));
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

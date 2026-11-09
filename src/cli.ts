#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { Replica } from './replica.js';
import { OpLog } from './store/oplog.js';
import { MemoryLog } from './store/memory-log.js';
import { serve } from './sync/server.js';
import { sync } from './sync/client.js';
import type { AddressInfo } from 'node:net';

const USAGE = `converge — local-first sync engine

  converge demo                       two replicas, partition, merge
  converge serve --port 8787          run a sync endpoint
  converge sync <url> --actor <name>  pull/push against an endpoint
  converge log <file>                 replay a log and print state
  converge new <file>                 create a log with sample content
`;

async function listen(replica: Replica, port: number): Promise<{ close(): Promise<void>; url: string }> {
  const server = serve({ peer: replica, onOps: (ops) => replica.receiveAll(ops) });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function demo(): Promise<void> {
  const alice = await Replica.open('alice', new MemoryLog());
  const bob = await Replica.open('bob', new MemoryLog());

  await alice.createText('notes');
  await bob.createText('notes');
  await alice.insert('notes', 0, 'ship the sync engine');
  await bob.insert('notes', 0, 'today: ');

  // Partitioned: neither replica can see the other.
  const bobServer = await listen(bob, 0);
  const aliceServer = await listen(alice, 0);
  console.log('alice (offline):', JSON.stringify(alice.document.toJSON()));
  console.log('bob   (offline):', JSON.stringify(bob.document.toJSON()));

  await sync(bobServer.url, alice, (ops) => alice.receiveAll(ops));
  await sync(aliceServer.url, bob, (ops) => bob.receiveAll(ops));
  await bobServer.close();
  await aliceServer.close();

  const a = JSON.stringify(alice.document.toJSON());
  const b = JSON.stringify(bob.document.toJSON());
  console.log('alice (merged): ', a);
  console.log('bob   (merged): ', b);

  if (a !== b) {
    console.error('DIVERGED');
    process.exitCode = 1;
    return;
  }
  console.log(`\nconverged. pending buffers: alice=${alice.pendingCount} bob=${bob.pendingCount}`);
  console.log('demo logs are in-memory');
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', default: '8787' },
      actor: { type: 'string', default: 'cli' },
      data: { type: 'string', default: '.data' },
    },
  });

  const [command, target] = positionals;

  switch (command) {
    case 'demo':
      return demo();

    case 'serve': {
      const replica = await Replica.open(values.actor, new OpLog(join(values.data, `${values.actor}.log`)));
      const handle = await listen(replica, Number(values.port));
      console.log(`listening on ${handle.url} as ${values.actor}`);
      return;
    }

    case 'sync': {
      if (target === undefined) throw new Error('sync needs a url');
      const replica = await Replica.open(values.actor, new OpLog(join(values.data, `${values.actor}.log`)));
      const result = await sync(target, replica, (ops) => replica.receiveAll(ops));
      console.log(JSON.stringify({ ...result, state: replica.document.toJSON() }, null, 2));
      return;
    }

    case 'log': {
      if (target === undefined) throw new Error('log needs a file');
      const replica = await Replica.open(values.actor, new OpLog(target));
      console.log(JSON.stringify(replica.document.toJSON(), null, 2));
      return;
    }

    case 'new': {
      if (target === undefined) throw new Error('new needs a file');
      const replica = await Replica.open(values.actor, new OpLog(target));
      await replica.createText('body');
      await replica.insert('body', 0, 'hello');
      console.log(`wrote ${target}`);
      return;
    }

    default:
      console.log(USAGE);
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});

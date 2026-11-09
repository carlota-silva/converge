import type { Log } from './oplog.js';
import type { Op } from '../core/op.js';

export class MemoryLog implements Log {
  readonly ops: Op[] = [];
  #open = false;

  async open(): Promise<void> {
    this.#open = true;
  }

  async close(): Promise<void> {
    this.#open = false;
  }

  async append(op: Op): Promise<void> {
    if (!this.#open) throw new Error('log is not open');
    this.ops.push(op);
  }

  async sync(): Promise<void> {}

  async readAll(): Promise<Op[]> {
    return [...this.ops];
  }

  async rewrite(ops: readonly Op[]): Promise<void> {
    this.ops.length = 0;
    this.ops.push(...ops);
  }
}

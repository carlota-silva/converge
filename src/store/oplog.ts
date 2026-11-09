import { open, mkdir, readFile, writeFile, truncate, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { decodeOps, type Op } from '../core/op.js';

/** Anything that can durably hold an operation sequence. */
export interface Log {
  open(): Promise<void>;
  close(): Promise<void>;
  append(op: Op): Promise<void>;
  sync(): Promise<void>;
  readAll(): Promise<Op[]>;
  rewrite(ops: readonly Op[]): Promise<void>;
}

/**
 * Append-only file log. One JSON operation per line, so a torn tail costs at
 * most the final line rather than the file.
 */
export class OpLog implements Log {
  readonly #path: string;
  #handle: FileHandle | null = null;

  constructor(path: string) {
    this.#path = path;
  }

  get path(): string {
    return this.#path;
  }

  async open(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    this.#handle = await open(this.#path, 'a');
  }

  async close(): Promise<void> {
    await this.#handle?.close();
    this.#handle = null;
  }

  async append(op: Op): Promise<void> {
    if (this.#handle === null) throw new Error('log is not open');
    await this.#handle.write(`${JSON.stringify(op)}\n`);
  }

  async sync(): Promise<void> {
    await this.#handle?.sync();
  }

  async readAll(): Promise<Op[]> {
    let raw: string;
    try {
      raw = await readFile(this.#path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const lines = raw.split('\n');
    const ops: Op[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!.trim();
      if (line === '') continue;
      try {
        ops.push(...decodeOps([JSON.parse(line)]));
      } catch (error) {
        const trailing = lines.slice(i + 1).every((rest) => rest.trim() === '');
        // Only an incomplete, unterminated last JSON record is a torn write.
        // A complete but invalid operation must never be silently discarded.
        const torn = trailing && !raw.endsWith('\n') && error instanceof SyntaxError;
        if (torn) {
          // Remove the bad tail before a future append can join two JSON records.
          const validPrefix = lines.slice(0, i).join('\n') + (i > 0 ? '\n' : '');
          await truncate(this.#path, Buffer.byteLength(validPrefix, 'utf8'));
          break;
        }
        throw new Error(`corrupt log at line ${i + 1}: ${(error as Error).message}`);
      }
    }
    return ops;
  }

  async rewrite(ops: readonly Op[]): Promise<void> {
    await writeFile(this.#path, ops.map((op) => `${JSON.stringify(op)}\n`).join(''));
  }
}

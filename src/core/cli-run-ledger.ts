/**
 * CLI local run ledger — ~/.scholaracle-scraper/logs/
 * Structured JSONL per day. No credentials.
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface ICliRunLogEntry {
  readonly runId: string;
  readonly provider: string;
  readonly status: 'success' | 'failed' | 'started';
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly opCount?: number;
  readonly errorMessage?: string;
  readonly adapterVersion?: string;
  readonly coreVersion?: string;
  readonly bundleHash?: string;
}

function logsDir(): string {
  return join(homedir(), '.scholaracle-scraper', 'logs');
}

function dayFile(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return join(logsDir(), `runs-${y}${m}${day}.jsonl`);
}

export function appendCliRunLog(entry: ICliRunLogEntry, baseDir?: string): string {
  const dir = baseDir ?? logsDir();
  mkdirSync(dir, { recursive: true });
  const file = baseDir
    ? join(dir, `runs-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.jsonl`)
    : dayFile();
  appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  return file;
}

export function readCliRunLogs(filePath: string): ICliRunLogEntry[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ICliRunLogEntry);
}

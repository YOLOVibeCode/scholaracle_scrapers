/**
 * CLI run ledger tests (TDD) — uses temp dir, no home pollution.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendCliRunLog, readCliRunLogs } from './cli-run-ledger';

describe('cli-run-ledger', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'slc-ledger-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should append and read JSONL entries without credentials', () => {
    const file = appendCliRunLog(
      {
        runId: 'r1',
        provider: 'canvas',
        status: 'success',
        startedAt: '2026-01-01T00:00:00Z',
        opCount: 3,
        coreVersion: '0.1.0',
      },
      dir,
    );
    const entries = readCliRunLogs(file);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.runId).toBe('r1');
    expect(JSON.stringify(entries[0])).not.toMatch(/password/i);
  });
});

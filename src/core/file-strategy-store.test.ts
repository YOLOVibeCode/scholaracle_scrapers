/**
 * TDD: FileStrategyStore tests using tmp dir.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileStrategyStore } from './file-strategy-store';
import type { IExtractionStrategy } from './strategy-store';

const TEST_DIR = join(tmpdir(), 'scholaracle-strategy-test-' + Date.now());

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function makeStrategy(overrides?: Partial<IExtractionStrategy>): IExtractionStrategy {
  const now = new Date().toISOString();
  return {
    extractionId: 'skyward:gradebook:courses',
    platform: 'skyward',
    selectors: [{ type: 'regex', value: 'classDesc_(\\d+)' }],
    version: 1,
    createdAt: now,
    updatedAt: now,
    successCount: 1,
    failCount: 0,
    ...overrides,
  };
}

describe('FileStrategyStore', () => {
  it('get returns null for missing extractionId', async () => {
    const store = new FileStrategyStore(TEST_DIR);
    expect(await store.get('nonexistent:id')).toBeNull();
  });

  it('save and get round-trip', async () => {
    const store = new FileStrategyStore(TEST_DIR);
    const strategy = makeStrategy({ extractionId: 'roundtrip:test' });
    await store.save(strategy);
    const got = await store.get('roundtrip:test');
    expect(got).toEqual(strategy);
  });

  it('invalidate removes strategy file', async () => {
    const store = new FileStrategyStore(TEST_DIR);
    const strategy = makeStrategy({ extractionId: 'to:invalidate' });
    await store.save(strategy);
    expect(await store.get('to:invalidate')).toEqual(strategy);
    await store.invalidate('to:invalidate');
    expect(await store.get('to:invalidate')).toBeNull();
  });

  it('creates strategies directory if missing', async () => {
    const nestedDir = join(TEST_DIR, 'nested');
    const store = new FileStrategyStore(nestedDir);
    const strategy = makeStrategy({ extractionId: 'creates:dir' });
    await store.save(strategy);
    const got = await store.get('creates:dir');
    expect(got).toEqual(strategy);
  });

  it('sanitizes extractionId for filename', async () => {
    const store = new FileStrategyStore(TEST_DIR);
    const strategy = makeStrategy({ extractionId: 'platform:section:item' });
    await store.save(strategy);
    const got = await store.get('platform:section:item');
    expect(got).toEqual(strategy);
  });
});

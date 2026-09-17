/**
 * Fixture replay — holds the transformers to real captured portal data.
 *
 * For every fixture under fixtures/<sourceId>/ (captured by `acceptance.ts`
 * live runs, gitignored because it contains real student data), this suite:
 *   1. re-runs the provider's transformer over the captured raw data,
 *   2. validates the resulting envelope,
 *   3. re-judges it against the checked-in expectations in acceptance/.
 *
 * With no fixtures captured (e.g. CI), the suite reports a single skipped test.
 */

import { join } from 'node:path';
import { listFixtures, loadFixture, loadExpectations, evaluateAcceptance } from './acceptance';
import { validateEnvelope } from '@scholaracle/scraper-core';
// Transformers come from @scholaracle/scraper-core — the same modules the live
// scrapers delegate to (the local src/scrapers/*/*-transformer.ts copies are legacy).
import {
  transformCanvasExtract,
  transformSkywardExtract,
  transformAeriesExtract,
  type ICanvasBrowserExtract,
  type ISkywardFullExtract,
  type IAeriesFullExtract,
} from '@scholaracle/scraper-core';
import type { ISlcDeltaOp } from '@scholaracle/contracts';
import type { IFixture } from './acceptance';

const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures');
const EXPECTATIONS_DIR = join(__dirname, '..', '..', 'acceptance');

function replayTransform(fixture: IFixture): ISlcDeltaOp[] {
  const ctx = fixture.meta.transformContext;
  switch (fixture.meta.provider) {
    case 'canvas':
      return transformCanvasExtract(fixture.rawData as unknown as ICanvasBrowserExtract, ctx);
    case 'skyward':
      return transformSkywardExtract(fixture.rawData as unknown as ISkywardFullExtract, ctx);
    case 'aeries':
      return transformAeriesExtract(fixture.rawData as unknown as IAeriesFullExtract, ctx);
    default:
      throw new Error(`No transformer mapped for provider "${fixture.meta.provider}"`);
  }
}

const sourceIds = listFixtures(FIXTURES_DIR);

describe('fixture replay', () => {
  if (sourceIds.length === 0) {
    it.skip('no captured fixtures — run `npm run acceptance` to record some', () => {});
    return;
  }

  describe.each(sourceIds)('%s', sourceId => {
    const fixture = loadFixture(FIXTURES_DIR, sourceId)!;

    it('transformer reproduces a non-empty op set from captured raw data', () => {
      const ops = replayTransform(fixture);
      expect(ops.length).toBeGreaterThan(0);
    });

    it('replayed envelope passes schema validation', () => {
      const ops = replayTransform(fixture);
      const report = validateEnvelope({ ...fixture.envelope, ops });
      const errors = report.checks.filter(c => c.severity === 'error').map(c => c.message);
      expect(errors).toEqual([]);
      expect(report.passed).toBe(true);
    });

    it('replayed envelope still meets the recorded acceptance expectations', () => {
      const expectations = loadExpectations(EXPECTATIONS_DIR, sourceId);
      if (!expectations) {
        // Fixture captured but standard not yet recorded — nothing to hold it to.
        return;
      }
      const ops = replayTransform(fixture);
      const acceptance = evaluateAcceptance({ ...fixture.envelope, ops }, expectations);
      const failed = acceptance.checks
        .filter(c => !c.isPassed)
        .map(c => `${c.name}: expected >= ${c.expected}, got ${c.actual}`);
      expect(failed).toEqual([]);
    });
  });
});

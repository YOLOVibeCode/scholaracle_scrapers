/**
 * Compatibility barrel — scraper types moved to scraper-types.ts, but the
 * root-level runner scripts (test-canvas.ts, test-skyward.ts, acceptance.ts)
 * and external consumers import from core/types.
 */
export * from './scraper-types';
export type {
  ISlcDeltaOp,
  ISlcIngestEnvelopeV1,
} from '@scholaracle/contracts';

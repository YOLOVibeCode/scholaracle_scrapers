/**
 * Platform-agnostic strategy caching for scrapers.
 * Remembers successful extraction paths and replays them before falling back to normal/AI.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ISelectorStep {
  readonly type: 'css' | 'regex' | 'xpath' | 'evaluate' | 'ai';
  readonly value: string;
  readonly description?: string;
}

export interface IExtractionStrategy {
  readonly extractionId: string;
  readonly platform: string;
  readonly selectors: readonly ISelectorStep[];
  readonly htmlFingerprint?: string;
  readonly aiSchema?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly successCount: number;
  readonly failCount: number;
}

export interface IStrategyStore {
  get(extractionId: string): Promise<IExtractionStrategy | null>;
  save(strategy: IExtractionStrategy): Promise<void>;
  invalidate(extractionId: string): Promise<void>;
}

export interface IStrategyAttempt<T> {
  readonly extractionId: string;
  readonly platform: string;
  readonly store?: IStrategyStore;
  readonly tryCached: (strategy: IExtractionStrategy) => Promise<T | null>;
  readonly tryNormal: () => Promise<{ data: T; selectors: readonly ISelectorStep[] } | null>;
  readonly tryAi?: (schema: string) => Promise<{ data: T; selectors: readonly ISelectorStep[] } | null>;
  readonly aiSchema?: string;
  readonly htmlFingerprint?: string;
}

// ---------------------------------------------------------------------------
// HTML Fingerprinting
// ---------------------------------------------------------------------------

export function computeFingerprint(html: string): string {
  const structural = html
    .replace(/>([^<]+)</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(structural).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// useStrategy orchestrator
// ---------------------------------------------------------------------------

export async function useStrategy<T>(attempt: IStrategyAttempt<T>): Promise<T> {
  const { extractionId, platform, store, tryCached, tryNormal, tryAi, aiSchema, htmlFingerprint } = attempt;

  if (store) {
    const cached = await store.get(extractionId);
    if (cached) {
      const result = await tryCached(cached);
      if (result !== null) {
        return result;
      }
      await store.invalidate(extractionId);
    }
  }

  const normalResult = await tryNormal();
  if (normalResult) {
    if (store) {
      const now = new Date().toISOString();
      await store.save({
        extractionId,
        platform,
        selectors: normalResult.selectors,
        htmlFingerprint,
        version: 1,
        createdAt: now,
        updatedAt: now,
        successCount: 1,
        failCount: 0,
      });
    }
    return normalResult.data;
  }

  if (tryAi && aiSchema) {
    const aiResult = await tryAi(aiSchema);
    if (aiResult) {
      if (store) {
        const now = new Date().toISOString();
        await store.save({
          extractionId,
          platform,
          selectors: aiResult.selectors,
          htmlFingerprint,
          aiSchema,
          version: 1,
          createdAt: now,
          updatedAt: now,
          successCount: 1,
          failCount: 0,
        });
      }
      return aiResult.data;
    }
  }

  throw new Error(`Could not extract data for ${extractionId}`);
}

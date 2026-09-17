/**
 * Acceptance harness core — "the kids are the standard."
 *
 * Each child × portal is an acceptance profile identified by its sourceId
 * (e.g. skyward-ava-lewis). A live run against the real portal:
 *   1. captures the raw scrape() output as a local fixture (gitignored — real data),
 *   2. produces a validated envelope,
 *   3. is judged against per-source expectations (entity minimums recorded
 *      from a known-good run — counts only, no PII, safe to commit).
 *
 * Fixture replay tests then hold the transformers to the captured real-portal
 * data without any network access.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ISlcIngestEnvelopeV1 } from '@scholaracle/contracts';

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

export interface IAcceptanceExpectations {
  readonly sourceId: string;
  /** Minimum total ops the envelope must contain. */
  readonly minTotalOps: number;
  /** Minimum op count per entity type (e.g. { course: 5, gradeSnapshot: 5 }). */
  readonly entities: Readonly<Record<string, number>>;
  /** When these expectations were recorded, and from which run's actual counts. */
  readonly recordedAt: string;
  readonly recordedFrom?: Readonly<Record<string, number>>;
}

export interface IAcceptanceCheck {
  readonly name: string;
  readonly isPassed: boolean;
  readonly expected: number;
  readonly actual: number;
}

export interface IAcceptanceReport {
  readonly sourceId: string;
  readonly isPassed: boolean;
  readonly checks: readonly IAcceptanceCheck[];
}

export function countEntities(envelope: ISlcIngestEnvelopeV1): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const op of envelope.ops) {
    counts[op.entity] = (counts[op.entity] ?? 0) + 1;
  }
  return counts;
}

/**
 * Judge an envelope against recorded expectations.
 * Fails when total ops or any per-entity count drops below the recorded minimum.
 */
export function evaluateAcceptance(
  envelope: ISlcIngestEnvelopeV1,
  expectations: IAcceptanceExpectations,
): IAcceptanceReport {
  const counts = countEntities(envelope);
  const checks: IAcceptanceCheck[] = [];

  checks.push({
    name: 'total-ops',
    isPassed: envelope.ops.length >= expectations.minTotalOps,
    expected: expectations.minTotalOps,
    actual: envelope.ops.length,
  });

  for (const [entity, min] of Object.entries(expectations.entities)) {
    const actual = counts[entity] ?? 0;
    checks.push({
      name: `entity:${entity}`,
      isPassed: actual >= min,
      expected: min,
      actual,
    });
  }

  return {
    sourceId: expectations.sourceId,
    isPassed: checks.every(c => c.isPassed),
    checks,
  };
}

/**
 * Draft expectations from a known-good run. Minimums are set to a fraction of
 * the observed counts (default 75%, floored, at least 1) so normal week-to-week
 * variance doesn't flake, but a broken extractor that drops a whole section does.
 */
export function draftExpectations(
  envelope: ISlcIngestEnvelopeV1,
  sourceId: string,
  slack = 0.75,
): IAcceptanceExpectations {
  const counts = countEntities(envelope);
  const entities: Record<string, number> = {};
  for (const [entity, count] of Object.entries(counts)) {
    entities[entity] = Math.max(1, Math.floor(count * slack));
  }
  return {
    sourceId,
    minTotalOps: Math.max(1, Math.floor(envelope.ops.length * slack)),
    entities,
    recordedAt: new Date().toISOString(),
    recordedFrom: counts,
  };
}

export function loadExpectations(dir: string, sourceId: string): IAcceptanceExpectations | undefined {
  const path = join(dir, `${sourceId}.json`);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as IAcceptanceExpectations;
}

export function saveExpectations(dir: string, expectations: IAcceptanceExpectations): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${expectations.sourceId}.json`);
  writeFileSync(path, `${JSON.stringify(expectations, null, 2)}\n`);
  return path;
}

// ---------------------------------------------------------------------------
// Fixtures (raw scrape output + envelope — real student data, never committed)
// ---------------------------------------------------------------------------

export interface IFixtureTransformContext {
  readonly provider: string;
  readonly adapterId: string;
  readonly studentExternalId: string;
  readonly institutionExternalId: string;
}

export interface IFixtureMeta {
  readonly sourceId: string;
  readonly provider: string;
  readonly capturedAt: string;
  readonly transformContext: IFixtureTransformContext;
  readonly totalOps: number;
  readonly entityCounts: Readonly<Record<string, number>>;
}

export interface IFixture {
  readonly meta: IFixtureMeta;
  readonly rawData: Record<string, unknown>;
  readonly envelope: ISlcIngestEnvelopeV1;
}

export function saveFixture(fixturesDir: string, fixture: IFixture): string {
  const dir = join(fixturesDir, fixture.meta.sourceId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(fixture.meta, null, 2)}\n`);
  writeFileSync(join(dir, 'raw.json'), `${JSON.stringify(fixture.rawData, null, 2)}\n`);
  writeFileSync(join(dir, 'envelope.json'), `${JSON.stringify(fixture.envelope, null, 2)}\n`);
  return dir;
}

export function loadFixture(fixturesDir: string, sourceId: string): IFixture | undefined {
  const dir = join(fixturesDir, sourceId);
  const metaPath = join(dir, 'meta.json');
  const rawPath = join(dir, 'raw.json');
  const envelopePath = join(dir, 'envelope.json');
  if (!existsSync(metaPath) || !existsSync(rawPath) || !existsSync(envelopePath)) return undefined;
  return {
    meta: JSON.parse(readFileSync(metaPath, 'utf-8')) as IFixtureMeta,
    rawData: JSON.parse(readFileSync(rawPath, 'utf-8')) as Record<string, unknown>,
    envelope: JSON.parse(readFileSync(envelopePath, 'utf-8')) as ISlcIngestEnvelopeV1,
  };
}

/** List sourceIds that have a complete captured fixture. */
export function listFixtures(fixturesDir: string): string[] {
  if (!existsSync(fixturesDir)) return [];
  return readdirSync(fixturesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(sourceId => loadFixture(fixturesDir, sourceId) !== undefined)
    .sort();
}

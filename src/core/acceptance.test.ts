import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  countEntities,
  draftExpectations,
  evaluateAcceptance,
  listFixtures,
  loadExpectations,
  loadFixture,
  saveExpectations,
  saveFixture,
  type IAcceptanceExpectations,
  type IFixture,
} from './acceptance';
import {
  SLC_INGEST_SCHEMA_VERSION_V1,
  type ISlcIngestEnvelopeV1,
  type ISlcDeltaOp,
} from '@scholaracle/contracts';

function makeOp(entity: string, externalId: string): ISlcDeltaOp {
  return {
    op: 'upsert',
    entity: entity as ISlcDeltaOp['entity'],
    key: {
      provider: 'skyward',
      adapterId: 'com.skyward.familyaccess',
      externalId,
      studentExternalId: 'stu-1',
      institutionExternalId: 'inst-1',
    },
    observedAt: '2026-08-12T12:00:00Z',
    record: { title: `Record ${externalId}` },
  };
}

function makeEnvelope(ops: ISlcDeltaOp[]): ISlcIngestEnvelopeV1 {
  return {
    schemaVersion: SLC_INGEST_SCHEMA_VERSION_V1,
    run: {
      runId: 'run-1',
      startedAt: '2026-08-12T12:00:00Z',
      provider: 'skyward',
      adapterId: 'com.skyward.familyaccess',
      adapterVersion: '1.0.0',
      mode: 'delta',
      timezone: 'America/Chicago',
    },
    source: {
      sourceId: 'skyward-test-kid',
      displayName: 'Skyward Family Access',
    },
    ops,
  };
}

const SIX_COURSE_OPS = [1, 2, 3, 4, 5, 6].map(n => makeOp('course', `c-${n}`));
const FOUR_GRADE_OPS = [1, 2, 3, 4].map(n => makeOp('gradeSnapshot', `g-${n}`));

describe('countEntities', () => {
  it('should count ops per entity type', () => {
    const counts = countEntities(makeEnvelope([...SIX_COURSE_OPS, ...FOUR_GRADE_OPS]));
    expect(counts).toEqual({ course: 6, gradeSnapshot: 4 });
  });

  it('should return an empty record for an empty envelope', () => {
    expect(countEntities(makeEnvelope([]))).toEqual({});
  });
});

describe('draftExpectations', () => {
  it('should set minimums at the slack fraction of observed counts', () => {
    const exp = draftExpectations(makeEnvelope([...SIX_COURSE_OPS, ...FOUR_GRADE_OPS]), 'skyward-test-kid');
    expect(exp.minTotalOps).toBe(7); // floor(10 * 0.75)
    expect(exp.entities['course']).toBe(4); // floor(6 * 0.75)
    expect(exp.entities['gradeSnapshot']).toBe(3);
    expect(exp.recordedFrom).toEqual({ course: 6, gradeSnapshot: 4 });
  });

  it('should never draft a minimum below 1', () => {
    const exp = draftExpectations(makeEnvelope([makeOp('course', 'c-1')]), 'skyward-test-kid');
    expect(exp.entities['course']).toBe(1);
    expect(exp.minTotalOps).toBe(1);
  });
});

describe('evaluateAcceptance', () => {
  const expectations: IAcceptanceExpectations = {
    sourceId: 'skyward-test-kid',
    minTotalOps: 8,
    entities: { course: 5, gradeSnapshot: 3 },
    recordedAt: '2026-08-12T12:00:00Z',
  };

  it('should pass when all counts meet the minimums', () => {
    const report = evaluateAcceptance(makeEnvelope([...SIX_COURSE_OPS, ...FOUR_GRADE_OPS]), expectations);
    expect(report.isPassed).toBe(true);
    expect(report.checks.every(c => c.isPassed)).toBe(true);
  });

  it('should fail when a whole entity type disappears', () => {
    const report = evaluateAcceptance(makeEnvelope(SIX_COURSE_OPS), expectations);
    expect(report.isPassed).toBe(false);
    const gradeCheck = report.checks.find(c => c.name === 'entity:gradeSnapshot');
    expect(gradeCheck?.isPassed).toBe(false);
    expect(gradeCheck?.actual).toBe(0);
  });

  it('should fail when an entity count drops below its minimum', () => {
    const report = evaluateAcceptance(
      makeEnvelope([...SIX_COURSE_OPS.slice(0, 4), ...FOUR_GRADE_OPS]),
      expectations,
    );
    expect(report.isPassed).toBe(false);
    expect(report.checks.find(c => c.name === 'entity:course')?.isPassed).toBe(false);
  });

  it('should fail on total ops below minimum even if per-entity minimums pass', () => {
    const tight: IAcceptanceExpectations = { ...expectations, minTotalOps: 99 };
    const report = evaluateAcceptance(makeEnvelope([...SIX_COURSE_OPS, ...FOUR_GRADE_OPS]), tight);
    expect(report.isPassed).toBe(false);
    expect(report.checks.find(c => c.name === 'total-ops')?.isPassed).toBe(false);
  });
});

describe('expectations + fixture persistence', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acceptance-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should round-trip expectations through save/load', () => {
    const exp = draftExpectations(makeEnvelope(SIX_COURSE_OPS), 'skyward-test-kid');
    saveExpectations(dir, exp);
    expect(loadExpectations(dir, 'skyward-test-kid')).toEqual(exp);
  });

  it('should return undefined for missing expectations', () => {
    expect(loadExpectations(dir, 'nope')).toBeUndefined();
  });

  it('should round-trip a fixture through save/load and list it', () => {
    const envelope = makeEnvelope(SIX_COURSE_OPS);
    const fixture: IFixture = {
      meta: {
        sourceId: 'skyward-test-kid',
        provider: 'skyward',
        capturedAt: '2026-08-12T12:00:00Z',
        transformContext: {
          provider: 'skyward',
          adapterId: 'com.skyward.familyaccess',
          studentExternalId: 'stu-1',
          institutionExternalId: 'inst-1',
        },
        totalOps: envelope.ops.length,
        entityCounts: countEntities(envelope),
      },
      rawData: { courses: [{ name: 'AP Math' }] },
      envelope,
    };
    saveFixture(dir, fixture);
    expect(loadFixture(dir, 'skyward-test-kid')).toEqual(fixture);
    expect(listFixtures(dir)).toEqual(['skyward-test-kid']);
  });

  it('should not list directories with incomplete fixtures', () => {
    mkdtempSync(join(dir, 'partial-'));
    expect(listFixtures(dir)).toEqual([]);
  });
});

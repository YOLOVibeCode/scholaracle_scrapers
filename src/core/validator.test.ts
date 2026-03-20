import { validateEnvelope, validateOp, type EnvelopeValidationReport } from './validator';
import {
  SLC_INGEST_SCHEMA_VERSION_V1,
  type ISlcIngestEnvelopeV1,
  type ISlcDeltaOp,
} from '@scholaracle/contracts';

function makeValidEnvelope(ops: ISlcDeltaOp[] = []): ISlcIngestEnvelopeV1 {
  return {
    schemaVersion: SLC_INGEST_SCHEMA_VERSION_V1,
    run: {
      runId: 'run-1',
      startedAt: '2026-02-16T12:00:00Z',
      provider: 'canvas',
      adapterId: 'com.instructure.canvas',
      adapterVersion: '1.0.0',
      mode: 'delta',
      timezone: 'America/Chicago',
    },
    source: {
      sourceId: 'source-1',
      displayName: 'Canvas LMS',
    },
    ops,
  };
}

function makeAssignmentOp(overrides?: Partial<ISlcDeltaOp>): ISlcDeltaOp {
  return {
    op: 'upsert',
    entity: 'assignment',
    key: {
      provider: 'canvas',
      adapterId: 'com.instructure.canvas',
      externalId: 'a-1',
      studentExternalId: 'stu-1',
      institutionExternalId: 'inst-1',
    },
    observedAt: '2026-02-16T12:00:00Z',
    record: { title: 'HW 1', status: 'graded', pointsPossible: 100, pointsEarned: 95 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateEnvelope
// ---------------------------------------------------------------------------

describe('validateEnvelope', () => {
  it('should pass for a valid envelope with ops', () => {
    const envelope = makeValidEnvelope([makeAssignmentOp()]);
    const report = validateEnvelope(envelope);
    expect(report.passed).toBe(true);
    expect(report.errorCount).toBe(0);
  });

  it('should pass for a valid envelope with zero ops (warning)', () => {
    const envelope = makeValidEnvelope([]);
    const report = validateEnvelope(envelope);
    expect(report.passed).toBe(true);
    expect(report.warningCount).toBeGreaterThan(0);
  });

  it('should fail for wrong schemaVersion', () => {
    const envelope = { ...makeValidEnvelope(), schemaVersion: 'wrong' as any };
    const report = validateEnvelope(envelope);
    expect(report.passed).toBe(false);
    expect(report.checks.some(c => c.severity === 'error' && c.name.includes('schema'))).toBe(true);
  });

  it('should fail for missing run.runId', () => {
    const envelope = makeValidEnvelope();
    const bad = { ...envelope, run: { ...envelope.run, runId: '' } };
    const report = validateEnvelope(bad);
    expect(report.passed).toBe(false);
  });

  it('should fail for missing run.provider', () => {
    const envelope = makeValidEnvelope();
    const bad = { ...envelope, run: { ...envelope.run, provider: '' } };
    const report = validateEnvelope(bad);
    expect(report.passed).toBe(false);
  });

  it('should fail for missing source.sourceId', () => {
    const envelope = makeValidEnvelope();
    const bad = { ...envelope, source: { ...envelope.source, sourceId: '' } };
    const report = validateEnvelope(bad);
    expect(report.passed).toBe(false);
  });

  it('should fail if ops is not an array', () => {
    const envelope = { ...makeValidEnvelope(), ops: 'not-array' as any };
    const report = validateEnvelope(envelope);
    expect(report.passed).toBe(false);
  });

  it('should report entity counts in stats', () => {
    const ops: ISlcDeltaOp[] = [
      makeAssignmentOp(),
      makeAssignmentOp({ key: { ...makeAssignmentOp().key, externalId: 'a-2' } }),
      {
        op: 'upsert', entity: 'course',
        key: { provider: 'canvas', adapterId: 'com.instructure.canvas', externalId: 'c-1' },
        observedAt: '2026-02-16T12:00:00Z',
        record: { title: 'Math' },
      },
    ];
    const report = validateEnvelope(makeValidEnvelope(ops));
    expect(report.entityCounts['assignment']).toBe(2);
    expect(report.entityCounts['course']).toBe(1);
    expect(report.totalOps).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// validateOp
// ---------------------------------------------------------------------------

describe('validateOp', () => {
  it('should pass for a valid upsert op', () => {
    const result = validateOp(makeAssignmentOp());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should pass for a valid delete op', () => {
    const result = validateOp({ ...makeAssignmentOp(), op: 'delete', record: undefined });
    expect(result.valid).toBe(true);
  });

  it('should fail for invalid op type', () => {
    const result = validateOp({ ...makeAssignmentOp(), op: 'bad' as any });
    expect(result.valid).toBe(false);
  });

  it('should fail for unknown entity type', () => {
    const result = validateOp({ ...makeAssignmentOp(), entity: 'foobar' as any });
    expect(result.valid).toBe(false);
  });

  it('should fail for missing key.provider', () => {
    const op = makeAssignmentOp();
    const result = validateOp({ ...op, key: { ...op.key, provider: '' } });
    expect(result.valid).toBe(false);
  });

  it('should fail for missing key.externalId', () => {
    const op = makeAssignmentOp();
    const result = validateOp({ ...op, key: { ...op.key, externalId: '' } });
    expect(result.valid).toBe(false);
  });

  it('should fail for missing observedAt', () => {
    const result = validateOp({ ...makeAssignmentOp(), observedAt: '' });
    expect(result.valid).toBe(false);
  });

  it('should fail for upsert without record', () => {
    const result = validateOp({ ...makeAssignmentOp(), record: undefined });
    expect(result.valid).toBe(false);
  });

  it('should pass delete without record', () => {
    const result = validateOp({ ...makeAssignmentOp(), op: 'delete', record: undefined });
    expect(result.valid).toBe(true);
  });

  it('should validate entity-specific required fields', () => {
    const result = validateOp({
      ...makeAssignmentOp(),
      record: { title: '' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('title'))).toBe(true);
  });
});

import {
  assessRisk,
  extractUpcomingDeadlines,
  buildStudentReport,
  type IRiskAssessment,
  type IUpcomingDeadline,
} from './student-insights';
import type { IReconciledGrade } from './grade-reconciler';
import type { ITrend } from './grade-history';
import type { ISlcDeltaOp } from './types';

function makeGrade(overrides: Partial<IReconciledGrade> & { courseName: string }): IReconciledGrade {
  return {
    officialGrade: 75,
    source: 'sis',
    discrepancy: false,
    ...overrides,
  };
}

function makeTrend(overrides?: Partial<ITrend>): ITrend {
  return { direction: 'stable', velocity: 0, totalChange: 0, dataPoints: 3, ...overrides };
}

function makeAssignmentOp(overrides: {
  title: string;
  dueAt: string;
  courseExternalId: string;
  pointsPossible?: number;
  status?: string;
}): ISlcDeltaOp {
  return {
    op: 'upsert',
    entity: 'assignment',
    key: {
      provider: 'canvas',
      adapterId: 'canvas-browser',
      externalId: 'a-1',
      studentExternalId: 'stu-1',
      institutionExternalId: 'inst-1',
      courseExternalId: overrides.courseExternalId,
    },
    observedAt: '2026-02-25T12:00:00Z',
    record: {
      title: overrides.title,
      dueAt: overrides.dueAt,
      pointsPossible: overrides.pointsPossible ?? 100,
      status: overrides.status,
      courseExternalId: overrides.courseExternalId,
    },
  };
}

describe('assessRisk', () => {
  it('should flag courses below 70% as critical', () => {
    const grades: IReconciledGrade[] = [
      makeGrade({ courseName: 'ALGEBRA 1', officialGrade: 65 }),
    ];
    const trends: Record<string, ITrend> = {
      'ALGEBRA 1': makeTrend({ direction: 'declining', velocity: -3 }),
    };

    const result = assessRisk(grades, trends);
    const alg = result.find(r => r.courseName === 'ALGEBRA 1');
    expect(alg).toBeDefined();
    expect(alg!.riskLevel).toBe('critical');
  });

  it('should flag courses 70-75% with declining trend as high risk', () => {
    const grades: IReconciledGrade[] = [
      makeGrade({ courseName: 'BIOLOGY', officialGrade: 72 }),
    ];
    const trends: Record<string, ITrend> = {
      'BIOLOGY': makeTrend({ direction: 'declining', velocity: -2 }),
    };

    const result = assessRisk(grades, trends);
    expect(result.find(r => r.courseName === 'BIOLOGY')!.riskLevel).toBe('high');
  });

  it('should flag courses 75-80% as moderate risk', () => {
    const grades: IReconciledGrade[] = [
      makeGrade({ courseName: 'ART 1', officialGrade: 77 }),
    ];
    const trends: Record<string, ITrend> = {
      'ART 1': makeTrend({ direction: 'stable' }),
    };

    const result = assessRisk(grades, trends);
    expect(result.find(r => r.courseName === 'ART 1')!.riskLevel).toBe('moderate');
  });

  it('should mark courses above 80% with stable/improving trends as low risk', () => {
    const grades: IReconciledGrade[] = [
      makeGrade({ courseName: 'SPANISH 1', officialGrade: 96 }),
    ];
    const trends: Record<string, ITrend> = {
      'SPANISH 1': makeTrend({ direction: 'improving', velocity: 2 }),
    };

    const result = assessRisk(grades, trends);
    expect(result.find(r => r.courseName === 'SPANISH 1')!.riskLevel).toBe('low');
  });

  it('should sort results by risk level (critical first)', () => {
    const grades: IReconciledGrade[] = [
      makeGrade({ courseName: 'SPANISH', officialGrade: 96 }),
      makeGrade({ courseName: 'JOURNALISM', officialGrade: 48 }),
      makeGrade({ courseName: 'BIOLOGY', officialGrade: 77 }),
    ];
    const trends: Record<string, ITrend> = {
      'SPANISH': makeTrend({ direction: 'stable' }),
      'JOURNALISM': makeTrend({ direction: 'declining' }),
      'BIOLOGY': makeTrend({ direction: 'stable' }),
    };

    const result = assessRisk(grades, trends);
    expect(result[0]!.courseName).toBe('JOURNALISM');
    expect(result[0]!.riskLevel).toBe('critical');
  });
});

describe('extractUpcomingDeadlines', () => {
  const NOW = new Date('2026-02-25T12:00:00Z');

  it('should extract assignments due within the window', () => {
    const ops: ISlcDeltaOp[] = [
      makeAssignmentOp({ title: 'Quiz', dueAt: '2026-02-27T23:59:00Z', courseExternalId: 'c-1', pointsPossible: 50 }),
      makeAssignmentOp({ title: 'HW', dueAt: '2026-03-01T23:59:00Z', courseExternalId: 'c-1', pointsPossible: 10 }),
      makeAssignmentOp({ title: 'Far away', dueAt: '2026-06-01T23:59:00Z', courseExternalId: 'c-1' }),
    ];

    const result = extractUpcomingDeadlines(ops, 7, NOW);
    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe('Quiz');
  });

  it('should exclude graded assignments but keep submitted/missing', () => {
    const ops: ISlcDeltaOp[] = [
      makeAssignmentOp({ title: 'Graded', dueAt: '2026-02-27T23:59:00Z', courseExternalId: 'c-1', status: 'graded' }),
      makeAssignmentOp({ title: 'Missing', dueAt: '2026-02-27T23:59:00Z', courseExternalId: 'c-1', status: 'missing' }),
      makeAssignmentOp({ title: 'Submitted', dueAt: '2026-02-27T23:59:00Z', courseExternalId: 'c-1', status: 'submitted' }),
    ];

    const result = extractUpcomingDeadlines(ops, 7, NOW);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.title).sort()).toEqual(['Missing', 'Submitted']);
  });

  it('should sort by due date (soonest first)', () => {
    const ops: ISlcDeltaOp[] = [
      makeAssignmentOp({ title: 'Later', dueAt: '2026-03-01T23:59:00Z', courseExternalId: 'c-1' }),
      makeAssignmentOp({ title: 'Sooner', dueAt: '2026-02-26T12:00:00Z', courseExternalId: 'c-1' }),
    ];

    const result = extractUpcomingDeadlines(ops, 7, NOW);
    expect(result[0]!.title).toBe('Sooner');
  });

  it('should flag high-point assignments as major', () => {
    const ops: ISlcDeltaOp[] = [
      makeAssignmentOp({ title: 'Big Test', dueAt: '2026-02-27T23:59:00Z', courseExternalId: 'c-1', pointsPossible: 200 }),
      makeAssignmentOp({ title: 'Small HW', dueAt: '2026-02-27T23:59:00Z', courseExternalId: 'c-1', pointsPossible: 10 }),
    ];

    const result = extractUpcomingDeadlines(ops, 7, NOW);
    expect(result.find(d => d.title === 'Big Test')!.major).toBe(true);
    expect(result.find(d => d.title === 'Small HW')!.major).toBe(false);
  });
});

describe('buildStudentReport', () => {
  it('excludes missing assignments in expired terms from missing count', () => {
    const grades: IReconciledGrade[] = [
      makeGrade({ courseName: 'MATH', officialGrade: 85 }),
    ];
    const trends: Record<string, ITrend> = { MATH: makeTrend() };
    const now = new Date('2026-03-15T12:00:00Z');
    const ops: ISlcDeltaOp[] = [
      {
        op: 'upsert',
        entity: 'academicTerm',
        key: {
          provider: 'canvas',
          adapterId: 'canvas-browser',
          externalId: 'canvas-term-fall-2025',
          studentExternalId: 'stu-1',
          institutionExternalId: 'inst-1',
        },
        observedAt: '2026-03-15T12:00:00Z',
        record: { title: 'Fall 2025', startDate: '2025-08-01', endDate: '2025-12-31', type: 'semester' },
      },
      {
        op: 'upsert',
        entity: 'academicTerm',
        key: {
          provider: 'canvas',
          adapterId: 'canvas-browser',
          externalId: 'canvas-term-spring-2026',
          studentExternalId: 'stu-1',
          institutionExternalId: 'inst-1',
        },
        observedAt: '2026-03-15T12:00:00Z',
        record: { title: 'Spring 2026', startDate: '2026-01-01', endDate: '2026-05-31', type: 'semester' },
      },
      makeAssignmentOp({
        title: 'Old missing',
        dueAt: '2025-10-01T23:59:00Z',
        courseExternalId: 'c-1',
        status: 'missing',
      }),
      makeAssignmentOp({
        title: 'Current missing',
        dueAt: '2026-03-20T23:59:00Z',
        courseExternalId: 'c-1',
        status: 'missing',
      }),
    ];
    const withTerm = (op: ISlcDeltaOp, termExternalId: string): ISlcDeltaOp => {
      if (op.entity !== 'assignment') return op;
      return {
        ...op,
        record: { ...(op.record as object), termExternalId },
      };
    };
    const opsWithTerms = [
      ops[0],
      ops[1],
      withTerm(ops[2]!, 'canvas-term-fall-2025'),
      withTerm(ops[3]!, 'canvas-term-spring-2026'),
    ];

    const report = buildStudentReport(grades, trends, opsWithTerms, 14, now);
    expect(report.missingAssignmentCount).toBe(1);
  });
});

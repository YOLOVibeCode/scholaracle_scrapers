import {
  reconcileGrades,
  matchCourses,
  type IReconciledGrade,
  type ICourseMatch,
  type IMatchCoursesOptions,
} from './grade-reconciler';
import type { ISlcDeltaOp } from './types';

function makeGradeOp(overrides: {
  provider: string;
  externalId: string;
  courseExternalId: string;
  percentGrade: number;
  sourceType: 'sis' | 'lms';
  letterGrade?: string;
}): ISlcDeltaOp {
  return {
    op: 'upsert',
    entity: 'gradeSnapshot',
    key: {
      provider: overrides.provider,
      adapterId: overrides.provider === 'skyward' ? 'skyward-browser' : 'canvas-browser',
      externalId: overrides.externalId,
      studentExternalId: 'stu-1',
      institutionExternalId: 'inst-1',
      courseExternalId: overrides.courseExternalId,
    },
    observedAt: '2026-02-25T12:00:00Z',
    record: {
      courseExternalId: overrides.courseExternalId,
      asOfDate: '2026-02-25',
      percentGrade: overrides.percentGrade,
      letterGrade: overrides.letterGrade,
      sourceType: overrides.sourceType,
    },
  };
}

function makeCourseOp(overrides: {
  provider: string;
  externalId: string;
  title: string;
  courseCode?: string;
  period?: string;
  teacherName?: string;
  teacherEmail?: string;
}): ISlcDeltaOp {
  return {
    op: 'upsert',
    entity: 'course',
    key: {
      provider: overrides.provider,
      adapterId: overrides.provider === 'skyward' ? 'skyward-browser' : 'canvas-browser',
      externalId: overrides.externalId,
      studentExternalId: 'stu-1',
      institutionExternalId: 'inst-1',
    },
    observedAt: '2026-02-25T12:00:00Z',
    record: {
      title: overrides.title,
      courseCode: overrides.courseCode,
      period: overrides.period,
      teacherName: overrides.teacherName,
      teacherEmail: overrides.teacherEmail,
    },
  };
}

describe('matchCourses', () => {
  it('should match courses by normalized name across providers', () => {
    const sisOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'skyward', externalId: 'sw-alg', title: 'ALGEBRA 1', period: '4' }),
      makeCourseOp({ provider: 'skyward', externalId: 'sw-bio', title: 'BIOLOGY', period: '8' }),
    ];
    const lmsOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'canvas', externalId: 'cv-alg', title: 'algebra🔢', courseCode: 'p04 - ALGEBRA 1 - Chang' }),
      makeCourseOp({ provider: 'canvas', externalId: 'cv-bio', title: 'biology🧬', courseCode: 'p01 - BIOLOGY - Hathaway' }),
    ];

    const matches = matchCourses(sisOps, lmsOps);
    expect(matches).toHaveLength(2);
    expect(matches.find(m => m.sisCourseId === 'sw-alg')?.lmsCourseId).toBe('cv-alg');
    expect(matches.find(m => m.sisCourseId === 'sw-bio')?.lmsCourseId).toBe('cv-bio');
  });

  it('should handle SIS-only courses (no Canvas match)', () => {
    const sisOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'skyward', externalId: 'sw-hum', title: 'PRINCIPLES HUMAN SERVICES' }),
    ];
    const lmsOps: ISlcDeltaOp[] = [];

    const matches = matchCourses(sisOps, lmsOps);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sisCourseId).toBe('sw-hum');
    expect(matches[0]!.lmsCourseId).toBeUndefined();
  });

  it('should handle LMS-only courses (no Skyward match)', () => {
    const sisOps: ISlcDeltaOp[] = [];
    const lmsOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'canvas', externalId: 'cv-art', title: 'art🎨', courseCode: 'p06 - ART 1 - Murray' }),
    ];

    const matches = matchCourses(sisOps, lmsOps);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.lmsCourseId).toBe('cv-art');
    expect(matches[0]!.sisCourseId).toBeUndefined();
  });

  it('should use course_code formal name when display name has emojis', () => {
    const sisOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'skyward', externalId: 'sw-span', title: 'SPANISH 1' }),
    ];
    const lmsOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'canvas', externalId: 'cv-span', title: 'spanish🇪🇸', courseCode: 'p07 - SPANISH 1 - Starks' }),
    ];

    const matches = matchCourses(sisOps, lmsOps);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sisCourseId).toBe('sw-span');
    expect(matches[0]!.lmsCourseId).toBe('cv-span');
  });
});

describe('reconcileGrades', () => {
  it('should prefer SIS grade when both sources have data', () => {
    const sisOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'skyward', externalId: 'sw-alg', title: 'ALGEBRA 1', period: '4', teacherName: 'Noah Chang' }),
      makeGradeOp({ provider: 'skyward', externalId: 'sw-g-alg', courseExternalId: 'sw-alg', percentGrade: 65, sourceType: 'sis' }),
    ];
    const lmsOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'canvas', externalId: 'cv-alg', title: 'algebra🔢', courseCode: 'p04 - ALGEBRA 1 - Chang', teacherName: 'nchang', teacherEmail: 'nchang@ldisd.net' }),
      makeGradeOp({ provider: 'canvas', externalId: 'cv-g-alg', courseExternalId: 'cv-alg', percentGrade: 84.91, sourceType: 'lms' }),
    ];

    const result = reconcileGrades(sisOps, lmsOps);
    const alg = result.find(r => r.courseName.includes('ALGEBRA'));
    expect(alg).toBeDefined();
    expect(alg!.officialGrade).toBe(65);
    expect(alg!.lmsGrade).toBe(84.91);
    expect(alg!.source).toBe('sis');
    expect(alg!.teacherName).toBe('Noah Chang');
    expect(alg!.teacherEmail).toBe('nchang@ldisd.net');
  });

  it('should use LMS grade when SIS has no grade', () => {
    const sisOps: ISlcDeltaOp[] = [];
    const lmsOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'canvas', externalId: 'cv-art', title: 'art🎨', courseCode: 'p06 - ART 1 - Murray' }),
      makeGradeOp({ provider: 'canvas', externalId: 'cv-g-art', courseExternalId: 'cv-art', percentGrade: 82.38, sourceType: 'lms' }),
    ];

    const result = reconcileGrades(sisOps, lmsOps);
    const art = result.find(r => r.courseName.includes('ART'));
    expect(art).toBeDefined();
    expect(art!.officialGrade).toBe(82.38);
    expect(art!.source).toBe('lms');
  });

  it('should use SIS grade when LMS has no grade', () => {
    const sisOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'skyward', externalId: 'sw-span', title: 'SPANISH 1', period: '7', teacherName: 'Lorraine Starks' }),
      makeGradeOp({ provider: 'skyward', externalId: 'sw-g-span', courseExternalId: 'sw-span', percentGrade: 96, sourceType: 'sis' }),
    ];
    const lmsOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'canvas', externalId: 'cv-span', title: 'spanish🇪🇸', courseCode: 'p07 - SPANISH 1 - Starks' }),
    ];

    const result = reconcileGrades(sisOps, lmsOps);
    const span = result.find(r => r.courseName.includes('SPANISH'));
    expect(span).toBeDefined();
    expect(span!.officialGrade).toBe(96);
    expect(span!.lmsGrade).toBeUndefined();
    expect(span!.source).toBe('sis');
  });

  it('should merge teacher contact info from LMS onto SIS course', () => {
    const sisOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'skyward', externalId: 'sw-wg', title: 'WORLD GEOGRAPHY', teacherName: 'Keelee Anderson' }),
      makeGradeOp({ provider: 'skyward', externalId: 'sw-g-wg', courseExternalId: 'sw-wg', percentGrade: 74, sourceType: 'sis' }),
    ];
    const lmsOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'canvas', externalId: 'cv-wg', title: 'world geography🗺️', courseCode: 'p02 - WORLD GEOGRAPHY - Anderson', teacherEmail: 'keanderson@ldisd.net' }),
      makeGradeOp({ provider: 'canvas', externalId: 'cv-g-wg', courseExternalId: 'cv-wg', percentGrade: 85.71, sourceType: 'lms' }),
    ];

    const result = reconcileGrades(sisOps, lmsOps);
    const wg = result.find(r => r.courseName.includes('GEOGRAPHY'));
    expect(wg).toBeDefined();
    expect(wg!.officialGrade).toBe(74);
    expect(wg!.teacherName).toBe('Keelee Anderson');
    expect(wg!.teacherEmail).toBe('keanderson@ldisd.net');
  });

  it('should flag large discrepancies between SIS and LMS', () => {
    const sisOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'skyward', externalId: 'sw-eng', title: 'ENGLISH 1' }),
      makeGradeOp({ provider: 'skyward', externalId: 'sw-g-eng', courseExternalId: 'sw-eng', percentGrade: 69, sourceType: 'sis' }),
    ];
    const lmsOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'canvas', externalId: 'cv-eng', title: 'english📝', courseCode: 'p05C - ENGLISH 1 - Starnes' }),
      makeGradeOp({ provider: 'canvas', externalId: 'cv-g-eng', courseExternalId: 'cv-eng', percentGrade: 131.73, sourceType: 'lms' }),
    ];

    const result = reconcileGrades(sisOps, lmsOps);
    const eng = result.find(r => r.courseName.includes('ENGLISH'));
    expect(eng).toBeDefined();
    expect(eng!.officialGrade).toBe(69);
    expect(eng!.delta).toBeCloseTo(62.73, 1);
    expect(eng!.discrepancy).toBe(true);
  });
});

describe('matchCourses with canonicalMap', () => {
  it('should match courses using AI canonical map even when rule-based fails', () => {
    const sisOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'skyward', externalId: 'sw-alg', title: 'ALGEBRA 1' }),
      makeCourseOp({ provider: 'skyward', externalId: 'sw-bio', title: 'BIOLOGY' }),
    ];
    const lmsOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'canvas', externalId: 'cv-alg', title: 'algebra' }),
      makeCourseOp({ provider: 'canvas', externalId: 'cv-bio', title: 'biology' }),
    ];

    const canonicalMap: Record<string, string> = {
      'ALGEBRA 1': 'ALGEBRA 1',
      'algebra': 'ALGEBRA 1',
      'BIOLOGY': 'BIOLOGY',
      'biology': 'BIOLOGY',
    };

    const matches = matchCourses(sisOps, lmsOps, { canonicalMap });
    expect(matches).toHaveLength(2);
    expect(matches.find(m => m.sisCourseId === 'sw-alg')?.lmsCourseId).toBe('cv-alg');
    expect(matches.find(m => m.sisCourseId === 'sw-bio')?.lmsCourseId).toBe('cv-bio');
  });

  it('should still fall back to rule-based when canonicalMap has no entry', () => {
    const sisOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'skyward', externalId: 'sw-span', title: 'SPANISH 1' }),
    ];
    const lmsOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'canvas', externalId: 'cv-span', title: 'spanish🇪🇸', courseCode: 'p07 - SPANISH 1 - Starks' }),
    ];

    const matches = matchCourses(sisOps, lmsOps, { canonicalMap: {} });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sisCourseId).toBe('sw-span');
    expect(matches[0]!.lmsCourseId).toBe('cv-span');
  });

  it('should prefer canonical map match over substring match', () => {
    const sisOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'skyward', externalId: 'sw-journ1', title: 'JOURNALISM' }),
      makeCourseOp({ provider: 'skyward', externalId: 'sw-journ3', title: 'JOURNALISM', period: '3' }),
    ];
    const lmsOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'canvas', externalId: 'cv-journ', title: 'journalism📰' }),
    ];

    const canonicalMap: Record<string, string> = {
      'JOURNALISM': 'JOURNALISM',
      'journalism📰': 'JOURNALISM',
    };

    const matches = matchCourses(sisOps, lmsOps, { canonicalMap });
    // One SIS should match the LMS, the other SIS should be unmatched
    const withLms = matches.filter(m => m.lmsCourseId);
    expect(withLms).toHaveLength(1);
    expect(withLms[0]!.lmsCourseId).toBe('cv-journ');
  });
});

describe('reconcileGrades with canonicalMap', () => {
  it('should reconcile grades when AI canonical map bridges title gap', () => {
    const sisOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'skyward', externalId: 'sw-alg', title: 'ALGEBRA 1' }),
      makeGradeOp({ provider: 'skyward', externalId: 'sw-g-alg', courseExternalId: 'sw-alg', percentGrade: 76, sourceType: 'sis' }),
    ];
    const lmsOps: ISlcDeltaOp[] = [
      makeCourseOp({ provider: 'canvas', externalId: 'cv-alg', title: 'algebra' }),
      makeGradeOp({ provider: 'canvas', externalId: 'cv-g-alg', courseExternalId: 'cv-alg', percentGrade: 85.84, sourceType: 'lms' }),
    ];

    const result = reconcileGrades(sisOps, lmsOps, {
      canonicalMap: { 'ALGEBRA 1': 'ALGEBRA 1', 'algebra': 'ALGEBRA 1' },
    });

    const alg = result.find(r => r.courseName.includes('ALGEBRA'));
    expect(alg).toBeDefined();
    expect(alg!.officialGrade).toBe(76);
    expect(alg!.lmsGrade).toBe(85.84);
    expect(alg!.source).toBe('sis');
    expect(alg!.sisCourseId).toBe('sw-alg');
    expect(alg!.lmsCourseId).toBe('cv-alg');
  });
});

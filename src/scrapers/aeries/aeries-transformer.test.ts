import {
  transformAeriesExtract,
  type IAeriesFullExtract,
  type TransformContext,
} from './aeries-transformer';

const ctx: TransformContext = {
  provider: 'aeries',
  adapterId: 'com.aeries.portal',
  studentExternalId: 'stu-christian',
  institutionExternalId: 'inst-kellerisd',
};

function makeExtract(overrides?: Partial<IAeriesFullExtract>): IAeriesFullExtract {
  return {
    students: [
      {
        name: 'Christian Vega',
        studentId: '728297',
        grade: '9',
        school: 'Keller High School',
        courses: [
          {
            period: '1',
            name: 'Spanish 1 b',
            term: 'Quarter 3',
            teacher: 'Casillas, S',
            teacherEmail: 'scasillas@kellerisd.net',
            room: 'S110',
            currentGrade: 89,
            currentPercent: 88.6,
            missingCount: 2,
            assignments: [
              {
                number: '1',
                title: 'Homework 5',
                category: 'Formative',
                scoreEarned: 18,
                scorePossible: 20,
                percentCorrect: 90,
                dateAssigned: '01/15/2026',
                dateDue: '01/20/2026',
                dateCompleted: '01/19/2026',
                gradingComplete: true,
                isMissing: false,
                comment: '',
              },
              {
                number: '2',
                title: 'Quiz 3',
                category: 'Summative',
                scoreEarned: null,
                scorePossible: 50,
                percentCorrect: null,
                dateAssigned: '01/25/2026',
                dateDue: '01/28/2026',
                dateCompleted: '',
                gradingComplete: false,
                isMissing: true,
                comment: '',
              },
            ],
          },
        ],
        attendance: [
          {
            date: '01/10/2026',
            period: '2',
            status: 'Absent',
            reason: 'Sick',
            course: 'Mathematics',
          },
          {
            date: '01/15/2026',
            period: '3',
            status: 'Tardy',
            reason: '',
            course: 'English',
          },
        ],
      },
    ],
    timestamp: '2026-02-16T12:00:00Z',
    ...overrides,
  };
}

describe('transformAeriesExtract', () => {
  it('should produce ops for all entity types in a full extract', () => {
    const ops = transformAeriesExtract(makeExtract(), ctx);

    const entityTypes = new Set(ops.map(o => o.entity));
    expect(entityTypes.has('studentProfile')).toBe(true);
    expect(entityTypes.has('course')).toBe(true);
    expect(entityTypes.has('gradeSnapshot')).toBe(true);
    expect(entityTypes.has('assignment')).toBe(true);
    expect(entityTypes.has('attendanceEvent')).toBe(true);
  });

  it('should create a studentProfile op from student name', () => {
    const ops = transformAeriesExtract(makeExtract(), ctx);
    const profile = ops.find(o => o.entity === 'studentProfile');
    expect(profile).toBeDefined();
    const rec = profile!.record as Record<string, unknown>;
    expect(rec.name).toBe('Christian Vega');
    expect(rec.studentId).toBe('728297');
    expect(rec.gradeLevel).toBe('9');
    expect(rec.school).toBe('Keller High School');
  });

  it('should create course ops with enriched fields', () => {
    const ops = transformAeriesExtract(makeExtract(), ctx);
    const course = ops.find(o => o.entity === 'course');
    expect(course).toBeDefined();
    const rec = course!.record as Record<string, unknown>;
    expect(rec.title).toBe('Spanish 1 b');
    expect(rec.teacherName).toBe('Casillas, S');
    expect(rec.teacherEmail).toBe('scasillas@kellerisd.net');
    expect(rec.period).toBe('1');
    expect(rec.room).toBe('S110');
  });

  it('should map course.currentPercent to gradeSnapshot.percentGrade', () => {
    const ops = transformAeriesExtract(makeExtract(), ctx);
    const grade = ops.find(o => o.entity === 'gradeSnapshot');
    expect(grade).toBeDefined();
    const rec = grade!.record as Record<string, unknown>;
    expect(rec.percentGrade).toBe(88.6);
    expect(rec.courseExternalId).toContain('aeries-course-');
    expect(rec.asOfDate).toBe('2026-02-16');
    expect(rec.missingCount).toBe(2);
  });

  it('should create assignment ops with correct field mapping', () => {
    const ops = transformAeriesExtract(makeExtract(), ctx);
    const assignments = ops.filter(o => o.entity === 'assignment');
    expect(assignments).toHaveLength(2);

    const hw = assignments.find(a => (a.record as Record<string, unknown>).title === 'Homework 5');
    expect(hw).toBeDefined();
    const hwRec = hw!.record as Record<string, unknown>;
    expect(hwRec.status).toBe('graded');
    expect(hwRec.pointsPossible).toBe(20);
    expect(hwRec.pointsEarned).toBe(18);
    expect(hwRec.percentScore).toBe(90);
    expect(hwRec.dueAt).toBe('2026-01-20');
    expect(hwRec.isMissing).toBe(false);

    const quiz = assignments.find(a => (a.record as Record<string, unknown>).title === 'Quiz 3');
    expect(quiz).toBeDefined();
    const quizRec = quiz!.record as Record<string, unknown>;
    expect(quizRec.status).toBe('missing');
    expect(quizRec.isMissing).toBe(true);
  });

  it('should create attendanceEvent ops with normalized status', () => {
    const ops = transformAeriesExtract(makeExtract(), ctx);
    const attendance = ops.filter(o => o.entity === 'attendanceEvent');
    expect(attendance).toHaveLength(2);

    const absent = attendance.find(a => (a.record as Record<string, unknown>).status === 'absent');
    expect(absent).toBeDefined();
    expect((absent!.record as Record<string, unknown>).date).toBe('2026-01-10');
    expect((absent!.record as Record<string, unknown>).periodName).toBe('2');
    expect((absent!.record as Record<string, unknown>).courseName).toBe('Mathematics');
    expect((absent!.record as Record<string, unknown>).excuseReason).toBe('Sick');

    const tardy = attendance.find(a => (a.record as Record<string, unknown>).status === 'tardy');
    expect(tardy).toBeDefined();
    expect((tardy!.record as Record<string, unknown>).date).toBe('2026-01-15');
  });

  it('should set correct key fields on all ops', () => {
    const ops = transformAeriesExtract(makeExtract(), ctx);
    for (const op of ops) {
      expect(op.key.provider).toBe('aeries');
      expect(op.key.adapterId).toBe('com.aeries.portal');
      expect(op.key.studentExternalId).toBe('stu-christian');
      expect(op.key.institutionExternalId).toBe('inst-kellerisd');
      expect(op.key.externalId).toBeTruthy();
      expect(op.observedAt).toBe('2026-02-16T12:00:00Z');
      expect(op.op).toBe('upsert');
    }
  });

  it('should return empty ops for empty extract', () => {
    const empty: IAeriesFullExtract = {
      students: [],
      timestamp: '2026-02-16T12:00:00Z',
    };
    const ops = transformAeriesExtract(empty, ctx);
    expect(ops).toHaveLength(0);
  });

  it('should handle course with no grade', () => {
    const extract = makeExtract({
      students: [
        {
          name: 'Test Student',
          studentId: '123',
          grade: '10',
          school: 'Test School',
          courses: [
            {
              period: '1',
              name: 'Art',
              term: 'Quarter 1',
              teacher: 'Smith',
              teacherEmail: '',
              room: 'A101',
              currentGrade: null,
              currentPercent: null,
              missingCount: 0,
              assignments: [],
            },
          ],
          attendance: [],
        },
      ],
    });
    const ops = transformAeriesExtract(extract, ctx);
    const grades = ops.filter(o => o.entity === 'gradeSnapshot');
    expect(grades).toHaveLength(0);
  });
});

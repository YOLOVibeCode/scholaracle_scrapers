import {
  transformSkywardExtract,
  type ISkywardFullExtract,
  type TransformContext,
} from './skyward-transformer';

const ctx: TransformContext = {
  provider: 'skyward',
  adapterId: 'com.skyward.familyaccess',
  studentExternalId: 'stu-ava',
  institutionExternalId: 'inst-ldisd',
};

function makeExtract(overrides?: Partial<ISkywardFullExtract>): ISkywardFullExtract {
  return {
    student: 'Ava Johnson',
    school: 'Lincoln High School',
    courses: [
      {
        name: 'AP Mathematics',
        period: '3',
        time: '7:30 AM - 8:15 AM',
        teacher: 'Mrs. Smith',
        currentGrade: '92',
        grades: { PR1: '90', '1ST': '91', PR2: '93', '2ND': '92', '3RD': '92' },
      },
      {
        name: 'English IV',
        period: '5',
        time: '9:00 AM - 9:45 AM',
        teacher: 'Mr. Brown',
        currentGrade: 'A',
        grades: {},
      },
    ],
    missingAssignments: [
      {
        title: 'Chapter 5 Homework',
        course: 'AP Mathematics',
        period: '3',
        teacher: 'Mrs. Smith',
        dueDate: '02/20/2026',
      },
    ],
    assignments: [
      {
        title: 'Quiz 1',
        course: 'AP Mathematics',
        period: '3',
        category: 'Major',
        dueDate: '02/10/2026',
        pointsEarned: '95',
        pointsPossible: '100',
        grade: '95',
        status: 'graded',
      },
    ],
    attendance: [
      {
        date: 'Wed Jan 7, 2026',
        period: '3',
        status: 'Absent',
        course: 'AP Mathematics',
        reason: 'Sick',
      },
    ],
    schedule: [
      {
        period: '3',
        time: '7:30 AM - 8:15 AM',
        course: 'AP Mathematics',
        teacher: 'Mrs. Smith',
        room: 'Room 204',
      },
    ],
    timestamp: '2026-02-16T12:00:00Z',
    ...overrides,
  };
}

describe('transformSkywardExtract', () => {
  it('should produce ops for all entity types in a full extract', () => {
    const ops = transformSkywardExtract(makeExtract(), ctx);

    const entityTypes = new Set(ops.map((o) => o.entity));
    expect(entityTypes.has('academicTerm')).toBe(true);
    expect(entityTypes.has('studentProfile')).toBe(true);
    expect(entityTypes.has('course')).toBe(true);
    expect(entityTypes.has('gradeSnapshot')).toBe(true);
    expect(entityTypes.has('assignment')).toBe(true);
    expect(entityTypes.has('attendanceEvent')).toBe(true);
  });

  it('should create a studentProfile op from student and school', () => {
    const ops = transformSkywardExtract(makeExtract(), ctx);
    const profile = ops.find((o) => o.entity === 'studentProfile');
    expect(profile).toBeDefined();
    const rec = profile!.record as Record<string, unknown>;
    expect(rec.name).toBe('Ava Johnson');
    expect(rec.school).toBe('Lincoln High School');
  });

  it('should create course ops with period, time, teacher, room', () => {
    const ops = transformSkywardExtract(makeExtract(), ctx);
    const courses = ops.filter((o) => o.entity === 'course');
    expect(courses.length).toBeGreaterThanOrEqual(1);

    const mathCourse = courses.find((c) => (c.record as Record<string, unknown>).title === 'AP Mathematics');
    expect(mathCourse).toBeDefined();
    const rec = mathCourse!.record as Record<string, unknown>;
    expect(rec.title).toBe('AP Mathematics');
    expect(rec.teacherName).toBe('Mrs. Smith');
    expect(rec.period).toBe('3');
    expect(rec.room).toBe('Room 204');
    expect(rec.startTime).toBe('7:30 AM');
    expect(rec.endTime).toBe('8:15 AM');
  });

  it('should create grade snapshot with parsed percentage and letter', () => {
    const ops = transformSkywardExtract(makeExtract(), ctx);
    const grades = ops.filter((o) => o.entity === 'gradeSnapshot');
    expect(grades.length).toBeGreaterThanOrEqual(1);

    const mathGrade = grades.find((g) => (g.key as { courseExternalId?: string }).courseExternalId?.includes('ap-mathematics'));
    expect(mathGrade).toBeDefined();
    const rec = mathGrade!.record as Record<string, unknown>;
    expect(rec.percentGrade).toBe(92);
    expect(rec.letterGrade).toBeUndefined(); // "92" has no letter
    expect(rec.asOfDate).toBe('2026-02-16');
  });

  it('should create assignment ops with status missing and termExternalId for expiration', () => {
    const ops = transformSkywardExtract(makeExtract({ assignments: [] }), ctx);
    const assignments = ops.filter((o) => o.entity === 'assignment');
    expect(assignments).toHaveLength(1);

    const rec = assignments[0]!.record as Record<string, unknown>;
    expect(rec.termExternalId).toBeDefined();
    expect(typeof rec.termExternalId).toBe('string');
    expect((rec.termExternalId as string).startsWith('skyward-term-')).toBe(true);
    expect(rec.title).toBe('Chapter 5 Homework');
    expect(rec.status).toBe('missing');
    expect(rec.dueAt).toBe('2026-02-20');
  });

  it('should emit graded assignment ops from extract.assignments with externalId, status, points, dueAt, termExternalId', () => {
    const ops = transformSkywardExtract(makeExtract(), ctx);
    const assignmentOps = ops.filter((o) => o.entity === 'assignment');
    const graded = assignmentOps.find(
      (o) => (o.record as Record<string, unknown>).title === 'Quiz 1'
    );
    expect(graded).toBeDefined();
    expect((graded!.key as { externalId?: string }).externalId).toMatch(/^skyward-assign-/);
    const rec = graded!.record as Record<string, unknown>;
    expect(rec.title).toBe('Quiz 1');
    expect(rec.status).toBe('graded');
    expect(rec.pointsEarned).toBe(95);
    expect(rec.pointsPossible).toBe(100);
    expect(rec.dueAt).toBe('2026-02-10');
    expect(rec.termExternalId).toBeDefined();
    expect((rec.termExternalId as string).startsWith('skyward-term-')).toBe(true);
  });

  it('should create attendanceEvent ops from attendance', () => {
    const ops = transformSkywardExtract(makeExtract(), ctx);
    const events = ops.filter((o) => o.entity === 'attendanceEvent');
    expect(events).toHaveLength(1);

    const rec = events[0]!.record as Record<string, unknown>;
    expect(rec.date).toBe('2026-01-07');
    expect(rec.status).toBe('absent');
    expect(rec.periodName).toBe('3');
    expect(rec.courseName).toBe('AP Mathematics');
    expect(rec.notes).toBe('Sick');
  });

  it('should set correct key fields on all ops', () => {
    const ops = transformSkywardExtract(makeExtract(), ctx);
    for (const op of ops) {
      expect(op.key.provider).toBe('skyward');
      expect(op.key.adapterId).toBe('com.skyward.familyaccess');
      expect(op.key.studentExternalId).toBe('stu-ava');
      expect(op.key.institutionExternalId).toBe('inst-ldisd');
      expect(op.key.externalId).toBeTruthy();
      expect(op.observedAt).toBe('2026-02-16T12:00:00Z');
      expect(op.op).toBe('upsert');
    }
  });

  it('should handle empty extract gracefully', () => {
    const empty: ISkywardFullExtract = {
      student: 'Unknown',
      school: '',
      courses: [],
      missingAssignments: [],
      assignments: [],
      attendance: [],
      schedule: [],
      timestamp: '2026-02-16T12:00:00Z',
    };
    const ops = transformSkywardExtract(empty, ctx);
    expect(ops.every((o) => o.entity === 'academicTerm')).toBe(true);
    expect(ops.length).toBe(13);
  });

  it('should handle course with no grade', () => {
    const extract = makeExtract({
      courses: [
        {
          name: 'Study Hall',
          period: '7',
          time: '',
          teacher: '',
          currentGrade: '',
          grades: {},
        },
      ],
    });
    const ops = transformSkywardExtract(extract, ctx);
    const grades = ops.filter((o) => o.entity === 'gradeSnapshot');
    expect(grades).toHaveLength(0);
  });
});

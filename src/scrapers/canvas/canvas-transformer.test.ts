import {
  transformCanvasExtract,
  type ICanvasBrowserExtract,
  type TransformContext,
} from './canvas-transformer';

const ctx: TransformContext = {
  provider: 'canvas',
  adapterId: 'com.instructure.canvas',
  studentExternalId: 'stu-emma',
  institutionExternalId: 'inst-ldisd',
};

function makeExtract(overrides?: Partial<ICanvasBrowserExtract>): ICanvasBrowserExtract {
  return {
    user: 'Emma Lewis',
    courses: [
      {
        id: '101',
        name: 'AP Mathematics',
        courseCode: 'MATH-301',
        period: '3rd',
        teacher: 'Mrs. Johnson',
        teachers: [
          { id: '50', name: 'Mrs. Johnson', email: 'johnson@school.edu' },
        ],
        term: 'Spring 2026',
        url: 'https://ldisd.instructure.com/courses/101',
        grade: '95.5% A',
        assignments: [
          { name: 'HW 5', dueDate: '2026-03-01T23:59:00Z', points: '100 pts', status: 'Graded' },
          { name: 'Quiz 3', dueDate: '2026-02-28T23:59:00Z', points: '50 pts', status: 'Missing' },
        ],
        modules: [{ name: 'Unit 5', items: ['5.1 Derivatives', '5.2 Integrals'] }],
        files: [{ name: 'study-guide.pdf', url: 'https://canvas.com/files/1/download', size: '1.2 MB' }],
      },
    ],
    toDoItems: [{ title: 'HW 5', course: 'AP Mathematics', dueDate: '2026-03-01' }],
    upcomingEvents: [{ title: 'Midterm', date: '2026-03-15', course: 'AP Mathematics' }],
    announcements: [{ title: 'Conference Next Week', course: 'AP Mathematics', date: '2026-02-15' }],
    timestamp: '2026-02-16T12:00:00Z',
    ...overrides,
  };
}

describe('transformCanvasExtract', () => {
  it('should produce ops for all entity types in a full extract', () => {
    const ops = transformCanvasExtract(makeExtract(), ctx);

    const entityTypes = new Set(ops.map(o => o.entity));
    expect(entityTypes.has('academicTerm')).toBe(true);
    expect(entityTypes.has('studentProfile')).toBe(true);
    expect(entityTypes.has('teacher')).toBe(true);
    expect(entityTypes.has('course')).toBe(true);
    expect(entityTypes.has('gradeSnapshot')).toBe(true);
    expect(entityTypes.has('assignment')).toBe(true);
    expect(entityTypes.has('courseMaterial')).toBe(true);
    expect(entityTypes.has('message')).toBe(true);
  });

  it('should create teacher ops with email and courseExternalIds', () => {
    const ops = transformCanvasExtract(makeExtract(), ctx);
    const teachers = ops.filter(o => o.entity === 'teacher');
    expect(teachers).toHaveLength(1);
    const rec = teachers[0]!.record as any;
    expect(rec.name).toBe('Mrs. Johnson');
    expect(rec.email).toBe('johnson@school.edu');
    expect(rec.courseExternalIds).toContain('canvas-course-101');
  });

  it('should create a studentProfile op from user name', () => {
    const ops = transformCanvasExtract(makeExtract(), ctx);
    const profile = ops.find(o => o.entity === 'studentProfile');
    expect(profile).toBeDefined();
    expect((profile!.record as any).name).toBe('Emma Lewis');
  });

  it('should create course ops with enriched fields', () => {
    const ops = transformCanvasExtract(makeExtract(), ctx);
    const course = ops.find(o => o.entity === 'course');
    expect(course).toBeDefined();
    const rec = course!.record as any;
    expect(rec.title).toBe('AP Mathematics');
    expect(rec.courseCode).toBe('MATH-301');
    expect(rec.teacherName).toBe('Mrs. Johnson');
    expect(rec.teacherEmail).toBe('johnson@school.edu');
    expect(rec.period).toBe('3rd');
    expect(rec.term).toBe('Spring 2026');
    expect(rec.url).toContain('instructure.com');
  });

  it('should create grade snapshot with parsed percentage and letter', () => {
    const ops = transformCanvasExtract(makeExtract(), ctx);
    const grade = ops.find(o => o.entity === 'gradeSnapshot');
    expect(grade).toBeDefined();
    const rec = grade!.record as any;
    expect(rec.percentGrade).toBe(95.5);
    expect(rec.letterGrade).toBe('A');
    expect(rec.courseExternalId).toBe('canvas-course-101');
    expect(rec.asOfDate).toBe('2026-02-16');
  });

  it('should create assignment ops with normalized status and termExternalId', () => {
    const ops = transformCanvasExtract(makeExtract(), ctx);
    const assignments = ops.filter(o => o.entity === 'assignment');
    expect(assignments).toHaveLength(2);

    const hw = assignments.find(a => (a.record as any).title === 'HW 5');
    expect(hw).toBeDefined();
    expect((hw!.record as any).status).toBe('graded');
    expect((hw!.record as any).pointsPossible).toBe(100);
    expect((hw!.record as any).termExternalId).toBe('canvas-term-spring-2026');

    const quiz = assignments.find(a => (a.record as any).title === 'Quiz 3');
    expect(quiz).toBeDefined();
    expect((quiz!.record as any).status).toBe('missing');
    expect((quiz!.record as any).termExternalId).toBe('canvas-term-spring-2026');
  });

  it('should create courseMaterial ops from files', () => {
    const ops = transformCanvasExtract(makeExtract(), ctx);
    const materials = ops.filter(o => o.entity === 'courseMaterial');
    expect(materials).toHaveLength(1);
    const rec = materials[0]!.record as any;
    expect(rec.title).toBe('study-guide.pdf');
    expect(rec.type).toBe('document');
    expect(rec.url).toContain('/download');
  });

  it('should create message ops from announcements', () => {
    const ops = transformCanvasExtract(makeExtract(), ctx);
    const messages = ops.filter(o => o.entity === 'message');
    expect(messages).toHaveLength(1);
    const rec = messages[0]!.record as any;
    expect(rec.subject).toBe('Conference Next Week');
    expect(rec.sentAt).toBe('2026-02-15');
  });

  it('should set correct key fields on all ops', () => {
    const ops = transformCanvasExtract(makeExtract(), ctx);
    for (const op of ops) {
      expect(op.key.provider).toBe('canvas');
      expect(op.key.adapterId).toBe('com.instructure.canvas');
      expect(op.key.studentExternalId).toBe('stu-emma');
      expect(op.key.institutionExternalId).toBe('inst-ldisd');
      expect(op.key.externalId).toBeTruthy();
      expect(op.observedAt).toBe('2026-02-16T12:00:00Z');
      expect(op.op).toBe('upsert');
    }
  });

  it('should handle empty extract gracefully', () => {
    const empty: ICanvasBrowserExtract = {
      user: 'Unknown',
      courses: [],
      toDoItems: [],
      upcomingEvents: [],
      announcements: [],
      timestamp: '2026-02-16T12:00:00Z',
    };
    const ops = transformCanvasExtract(empty, ctx);
    expect(ops.every((o) => o.entity === 'academicTerm')).toBe(true);
    expect(ops).toHaveLength(2);
  });

  it('should handle course with no grade', () => {
    const extract = makeExtract({
      courses: [{
        id: '200', name: 'Art', courseCode: 'ART-100', url: 'https://canvas.com/courses/200',
        teachers: [], assignments: [], modules: [], files: [],
      }],
    });
    const ops = transformCanvasExtract(extract, ctx);
    const grades = ops.filter(o => o.entity === 'gradeSnapshot');
    expect(grades).toHaveLength(0);
  });
});

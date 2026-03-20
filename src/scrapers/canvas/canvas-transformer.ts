import type { ISlcDeltaOp } from '@scholaracle/contracts';

// ---------------------------------------------------------------------------
// Semester inference from due date (Aug–Dec = fall, Jan–May = spring) for termExternalId
// ---------------------------------------------------------------------------

/** Parse YYYY-MM-DD from ISO or date string; returns undefined if unparseable. */
function parseDateToYMD(dateStr: string | undefined): string | undefined {
  if (!dateStr || dateStr.length < 10) return undefined;
  const iso = dateStr.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return undefined;
}

/**
 * Infer semester (fall-YYYY or spring-YYYY) from a due date for Canvas.
 * Aug–Dec → fall; Jan–May → spring; Jun–Jul → spring of same calendar year.
 */
function getCanvasTermExternalIdForDueDate(
  dueDateStr: string | undefined,
  extractTimestamp: string,
): string | undefined {
  const ymd = parseDateToYMD(dueDateStr);
  if (!ymd) return undefined;
  const year = parseInt(ymd.slice(0, 4), 10);
  const month = parseInt(ymd.slice(5, 7), 10);
  if (month >= 8 && month <= 12) return `canvas-term-fall-${year}`;
  if (month >= 1 && month <= 5) return `canvas-term-spring-${year}`;
  if (month === 6 || month === 7) return `canvas-term-spring-${year}`;
  return undefined;
}

/** Build fall/spring term definitions for the school year implied by extract timestamp. */
function getCanvasSemesterTerms(extractTimestamp: string): ReadonlyArray<{ externalId: string; title: string; startDate: string; endDate: string }> {
  const ymd = extractTimestamp.slice(0, 10);
  const year = parseInt(ymd.slice(0, 4), 10);
  const month = parseInt(ymd.slice(5, 7), 10);
  const fallYear = month >= 1 && month <= 7 ? year - 1 : year;
  const springYear = fallYear + 1;
  return [
    { externalId: `canvas-term-fall-${fallYear}`, title: `Fall ${fallYear}`, startDate: `${fallYear}-08-01`, endDate: `${fallYear}-12-31` },
    { externalId: `canvas-term-spring-${springYear}`, title: `Spring ${springYear}`, startDate: `${springYear}-01-01`, endDate: `${springYear}-05-31` },
  ];
}

// ---------------------------------------------------------------------------
// Raw Canvas extract types (output of the Playwright scrape phase)
// ---------------------------------------------------------------------------

export interface ICanvasBrowserExtract {
  user: string;
  courses: ICanvasBrowserCourse[];
  toDoItems: ICanvasBrowserToDoItem[];
  upcomingEvents: ICanvasBrowserEvent[];
  announcements: ICanvasBrowserAnnouncement[];
  timestamp: string;
}

export interface ICanvasBrowserTeacher {
  id: string;
  name: string;
  email?: string;
  bio?: string;
  pronouns?: string;
}

export interface ICanvasBrowserCourse {
  id: string;
  name: string;
  courseCode: string;
  period?: string;
  teacher?: string;
  teachers: ICanvasBrowserTeacher[];
  term?: string;
  url: string;
  grade?: string;
  assignments: ICanvasBrowserAssignment[];
  modules: ICanvasBrowserModule[];
  files: ICanvasBrowserFile[];
}

export interface ICanvasBrowserFile {
  name: string;
  url?: string;
  size?: string;
  contentType?: string;
  localPath?: string;
}

export interface ICanvasBrowserAssignment {
  name: string;
  dueDate?: string;
  points?: string;
  status?: string;
  attachments?: ICanvasBrowserFile[];
}

export interface ICanvasBrowserModule {
  name: string;
  items: string[];
}

export interface ICanvasBrowserToDoItem {
  title: string;
  course: string;
  dueDate?: string;
}

export interface ICanvasBrowserEvent {
  title: string;
  date: string;
  course?: string;
}

export interface ICanvasBrowserAnnouncement {
  title: string;
  course: string;
  date?: string;
}

// ---------------------------------------------------------------------------
// Transform: ICanvasBrowserExtract -> ISlcDeltaOp[]
// ---------------------------------------------------------------------------

export interface TransformContext {
  provider: string;
  adapterId: string;
  studentExternalId: string;
  institutionExternalId: string;
}

function parsePoints(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : undefined;
}

function parseGradePercent(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.match(/([\d.]+)\s*%/);
  return m ? parseFloat(m[1]!) : undefined;
}

function parseLetterGrade(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(/([A-F][+-]?)/i);
  return m ? m[1]! : undefined;
}

function normalizeStatus(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase().trim();
  if (lower.includes('miss')) return 'missing';
  if (lower.includes('late')) return 'late';
  if (lower.includes('submit')) return 'submitted';
  if (lower.includes('grad')) return 'graded';
  if (lower.includes('excus')) return 'excused';
  return 'unknown';
}

export function transformCanvasExtract(
  extract: ICanvasBrowserExtract,
  ctx: TransformContext,
): ISlcDeltaOp[] {
  const ops: ISlcDeltaOp[] = [];
  const now = extract.timestamp || new Date().toISOString();

  const baseKey = {
    provider: ctx.provider,
    adapterId: ctx.adapterId,
    studentExternalId: ctx.studentExternalId,
    institutionExternalId: ctx.institutionExternalId,
  };

  const semesterTerms = getCanvasSemesterTerms(extract.timestamp || now);
  for (const t of semesterTerms) {
    ops.push({
      op: 'upsert',
      entity: 'academicTerm',
      key: { ...baseKey, externalId: t.externalId },
      observedAt: now,
      record: {
        title: t.title,
        startDate: t.startDate,
        endDate: t.endDate,
        type: 'semester',
      },
    });
  }

  // Student profile
  if (extract.user && extract.user !== 'Unknown') {
    ops.push({
      op: 'upsert',
      entity: 'studentProfile',
      key: { ...baseKey, externalId: `canvas-profile-${ctx.studentExternalId}` },
      observedAt: now,
      record: { name: extract.user },
    });
  }

  // Teachers (deduplicated across courses)
  const seenTeachers = new Map<string, { teacher: ICanvasBrowserTeacher; courseExtIds: string[] }>();
  for (const course of extract.courses) {
    const courseExtId = `canvas-course-${course.id}`;
    for (const t of course.teachers) {
      const existing = seenTeachers.get(t.id);
      if (existing) {
        existing.courseExtIds.push(courseExtId);
      } else {
        seenTeachers.set(t.id, { teacher: t, courseExtIds: [courseExtId] });
      }
    }
  }
  for (const [tid, { teacher, courseExtIds }] of seenTeachers) {
    ops.push({
      op: 'upsert',
      entity: 'teacher',
      key: { ...baseKey, externalId: `canvas-teacher-${tid}` },
      observedAt: now,
      record: {
        name: teacher.name,
        email: teacher.email || undefined,
        courseExternalIds: courseExtIds,
      },
    });
  }

  // Courses + grade snapshots
  for (const course of extract.courses) {
    const courseExtId = `canvas-course-${course.id}`;
    const primaryTeacher = course.teachers[0];

    ops.push({
      op: 'upsert',
      entity: 'course',
      key: { ...baseKey, externalId: courseExtId },
      observedAt: now,
      record: {
        title: course.name,
        courseCode: course.courseCode || undefined,
        teacherName: primaryTeacher?.name || course.teacher || undefined,
        teacherEmail: primaryTeacher?.email || undefined,
        period: course.period || undefined,
        term: course.term || undefined,
        url: course.url,
      },
    });

    if (course.grade) {
      ops.push({
        op: 'upsert',
        entity: 'gradeSnapshot',
        key: { ...baseKey, externalId: `canvas-grade-${course.id}`, courseExternalId: courseExtId },
        observedAt: now,
        record: {
          courseExternalId: courseExtId,
          asOfDate: now.split('T')[0]!,
          percentGrade: parseGradePercent(course.grade),
          letterGrade: parseLetterGrade(course.grade),
          sourceType: 'lms' as const,
        },
      });
    }

    for (let i = 0; i < course.assignments.length; i++) {
      const a = course.assignments[i]!;
      const aExtId = `canvas-${course.id}-assignment-${i}`;
      const termExternalId = getCanvasTermExternalIdForDueDate(a.dueDate, extract.timestamp || now);

      ops.push({
        op: 'upsert',
        entity: 'assignment',
        key: { ...baseKey, externalId: aExtId, courseExternalId: courseExtId },
        observedAt: now,
        record: {
          title: a.name,
          dueAt: a.dueDate || undefined,
          pointsPossible: parsePoints(a.points),
          status: normalizeStatus(a.status),
          attachments: a.attachments?.map(att => ({
            name: att.name,
            url: att.url,
            type: att.contentType || undefined,
          })),
          courseExternalId: courseExtId,
          termExternalId,
        },
      });
    }

    for (const file of course.files) {
      ops.push({
        op: 'upsert',
        entity: 'courseMaterial',
        key: { ...baseKey, externalId: `canvas-file-${course.id}-${file.name}`, courseExternalId: courseExtId },
        observedAt: now,
        record: {
          title: file.name,
          courseExternalId: courseExtId,
          type: 'document' as const,
          url: file.url,
          fileName: file.name,
          mimeType: file.contentType || undefined,
        },
      });
    }
  }

  // Announcements -> messages
  for (let i = 0; i < extract.announcements.length; i++) {
    const ann = extract.announcements[i]!;
    const course = extract.courses.find(c => c.name === ann.course || c.id === ann.course);
    const courseExtId = course ? `canvas-course-${course.id}` : undefined;

    ops.push({
      op: 'upsert',
      entity: 'message',
      key: { ...baseKey, externalId: `canvas-announcement-${i}` },
      observedAt: now,
      record: {
        subject: ann.title,
        body: ann.title,
        senderName: 'Canvas',
        senderRole: 'system' as const,
        sentAt: ann.date || now,
        courseExternalId: courseExtId,
        category: 'academic' as const,
      },
    });
  }

  return ops;
}

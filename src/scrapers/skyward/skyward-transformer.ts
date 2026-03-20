import type { ISlcDeltaOp } from '@scholaracle/contracts';

// ---------------------------------------------------------------------------
// LDISD 2025-2026 grading periods (Texas 6-weeks; used for termExternalId and expiration)
// ---------------------------------------------------------------------------

const SKYWARD_TERM_DEFS: ReadonlyArray<{
  readonly code: string;
  readonly title: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly type: 'grading_period' | 'semester';
}> = [
  { code: 'PR1', title: 'Progress 1', startDate: '2025-08-18', endDate: '2025-09-26', type: 'grading_period' },
  { code: '1ST', title: '1st Six Weeks', startDate: '2025-08-18', endDate: '2025-09-26', type: 'grading_period' },
  { code: 'PR2', title: 'Progress 2', startDate: '2025-09-29', endDate: '2025-11-07', type: 'grading_period' },
  { code: '2ND', title: '2nd Six Weeks', startDate: '2025-09-29', endDate: '2025-11-07', type: 'grading_period' },
  { code: 'EX1', title: 'Exam 1', startDate: '2025-11-10', endDate: '2025-12-19', type: 'grading_period' },
  { code: 'SM1', title: 'Semester 1', startDate: '2025-08-18', endDate: '2025-12-19', type: 'semester' },
  { code: 'PR3', title: 'Progress 3', startDate: '2026-01-06', endDate: '2026-02-13', type: 'grading_period' },
  { code: '3RD', title: '3rd Six Weeks', startDate: '2026-01-06', endDate: '2026-02-13', type: 'grading_period' },
  { code: 'PR4', title: 'Progress 4', startDate: '2026-02-16', endDate: '2026-04-03', type: 'grading_period' },
  { code: '4TH', title: '4th Six Weeks', startDate: '2026-02-16', endDate: '2026-04-03', type: 'grading_period' },
  { code: 'EX2', title: 'Exam 2', startDate: '2026-04-06', endDate: '2026-05-22', type: 'grading_period' },
  { code: 'SM2', title: 'Semester 2', startDate: '2026-01-06', endDate: '2026-05-22', type: 'semester' },
  { code: 'FIN', title: 'Final', startDate: '2026-04-06', endDate: '2026-05-22', type: 'grading_period' },
];

/** Returns term externalId for the grading period that contains the given date (YYYY-MM-DD). */
function getTermExternalIdForDate(dateStr: string | undefined): string | undefined {
  if (!dateStr || dateStr.length < 10) return undefined;
  const d = dateStr.slice(0, 10);
  for (let i = SKYWARD_TERM_DEFS.length - 1; i >= 0; i--) {
    const t = SKYWARD_TERM_DEFS[i]!;
    if (d >= t.startDate && d <= t.endDate) return `skyward-term-${t.code}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Raw Skyward extract types (output of the Playwright scrape phase)
// ---------------------------------------------------------------------------

export interface ISkywardFullExtract {
  student: string;
  school: string;
  courses: ISkywardCourseExtract[];
  missingAssignments: ISkywardMissingAssignment[];
  assignments: ISkywardAssignmentExtract[];
  attendance: ISkywardAttendanceExtract[];
  schedule: ISkywardScheduleEntry[];
  timestamp: string;
}

export interface ISkywardCourseExtract {
  name: string;
  period: string;
  time: string;
  teacher: string;
  currentGrade: string;
  grades: Record<string, string>;
  /** Internal Skyward course number ID, used to match grade cells. */
  _cni?: string;
}

export interface ISkywardMissingAssignment {
  title: string;
  course: string;
  period: string;
  teacher: string;
  dueDate: string;
}

export interface ISkywardAssignmentExtract {
  readonly title: string;
  readonly course: string;
  readonly period: string;
  readonly category: string;
  readonly dueDate: string;
  readonly pointsEarned: string;
  readonly pointsPossible: string;
  readonly grade: string;
  readonly status: 'graded' | 'missing' | 'late' | 'unknown';
}

export interface ISkywardAttendanceExtract {
  date: string;
  period: string;
  status: string;
  course: string;
  reason: string;
}

export interface ISkywardScheduleEntry {
  period: string;
  time: string;
  course: string;
  teacher: string;
  room: string;
}

// ---------------------------------------------------------------------------
// Transform: ISkywardFullExtract -> ISlcDeltaOp[]
// ---------------------------------------------------------------------------

export interface TransformContext {
  provider: string;
  adapterId: string;
  studentExternalId: string;
  institutionExternalId: string;
}

function parseGradePercent(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.match(/([\d.]+)\s*%/);
  if (m) return parseFloat(m[1]!);
  const m2 = text.match(/^([\d.]+)$/);
  return m2 ? parseFloat(m2[1]!) : undefined;
}

function parseLetterGrade(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(/([A-F][+-]?)/i);
  return m ? m[1]! : undefined;
}

function parseTimeRange(time: string): { startTime?: string; endTime?: string } {
  if (!time) return {};
  const m = time.match(/(\d+:\d+\s*[AP]M)\s*-\s*(\d+:\d+\s*[AP]M)/i);
  if (m) return { startTime: m[1]!.trim(), endTime: m[2]!.trim() };
  return {};
}

function normalizeAttendanceStatus(raw: string): 'present' | 'absent' | 'tardy' | 'excused' | 'unexcused' | 'partial' | 'field_trip' {
  const lower = raw.toLowerCase().trim();
  if (lower.includes('present') || lower.includes('here')) return 'present';
  if (lower.includes('absent')) return lower.includes('excus') ? 'excused' : 'absent';
  if (lower.includes('tardy') || lower.includes('late')) return 'tardy';
  if (lower.includes('excus')) return 'excused';
  if (lower.includes('partial')) return 'partial';
  if (lower.includes('field') || lower.includes('trip')) return 'field_trip';
  return 'absent';
}

function parseDate(dateStr: string): string {
  if (!dateStr) return '';
  // "Wed Jan 7, 2026" -> "2026-01-07"
  const m = dateStr.match(/([A-Z][a-z]{2})\s+([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})/);
  if (m) {
    const months: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    };
    const mon = months[m[2]!] ?? '01';
    const day = m[3]!.padStart(2, '0');
    return `${m[4]}-${mon}-${day}`;
  }
  // "02/15/2026" -> "2026-02-15"
  const m2 = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) {
    return `${m2[3]}-${m2[1]!.padStart(2, '0')}-${m2[2]!.padStart(2, '0')}`;
  }
  return dateStr;
}

function slugify(s: string): string {
  return s.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase() || 'unknown';
}

export function transformSkywardExtract(
  extract: ISkywardFullExtract,
  ctx: TransformContext,
): ISlcDeltaOp[] {
  const ops: ISlcDeltaOp[] = [];
  const now = extract.timestamp || new Date().toISOString();
  const asOfDate = now.split('T')[0]!;

  const baseKey = {
    provider: ctx.provider,
    adapterId: ctx.adapterId,
    studentExternalId: ctx.studentExternalId,
    institutionExternalId: ctx.institutionExternalId,
  };

  // Academic terms (grading periods + semesters) for missing-assignment expiration
  for (const t of SKYWARD_TERM_DEFS) {
    ops.push({
      op: 'upsert',
      entity: 'academicTerm',
      key: { ...baseKey, externalId: `skyward-term-${t.code}` },
      observedAt: now,
      record: {
        title: t.title,
        startDate: t.startDate,
        endDate: t.endDate,
        type: t.type,
      },
    });
  }

  // Student profile (student + school)
  if (extract.student && extract.student !== 'Unknown') {
    ops.push({
      op: 'upsert',
      entity: 'studentProfile',
      key: { ...baseKey, externalId: `skyward-profile-${ctx.studentExternalId}` },
      observedAt: now,
      record: {
        name: extract.student,
        school: extract.school || undefined,
      },
    });
  }

  // Build schedule lookup by period for room/time enrichment
  const scheduleByPeriod = new Map<string, ISkywardScheduleEntry>();
  for (const s of extract.schedule) {
    if (s.period) scheduleByPeriod.set(s.period, s);
  }

  // Courses + grade snapshots (from gradebook)
  for (let i = 0; i < extract.courses.length; i++) {
    const course = extract.courses[i]!;
    const courseExtId = `skyward-course-${course.period}-${slugify(course.name)}`;
    const sched = scheduleByPeriod.get(course.period);
    const { startTime, endTime } = parseTimeRange(sched?.time || course.time);

    ops.push({
      op: 'upsert',
      entity: 'course',
      key: { ...baseKey, externalId: courseExtId },
      observedAt: now,
      record: {
        title: course.name,
        teacherName: course.teacher || undefined,
        period: course.period || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        room: sched?.room || undefined,
      },
    });

    // Grade snapshot per course (using grades Record / currentGrade)
    if (course.currentGrade || Object.keys(course.grades).length > 0) {
      const gradeVal = course.currentGrade || Object.values(course.grades).pop();
      ops.push({
        op: 'upsert',
        entity: 'gradeSnapshot',
        key: { ...baseKey, externalId: `skyward-grade-${course.period}-${slugify(course.name)}`, courseExternalId: courseExtId },
        observedAt: now,
        record: {
          courseExternalId: courseExtId,
          asOfDate,
          percentGrade: parseGradePercent(gradeVal),
          letterGrade: parseLetterGrade(gradeVal) || (gradeVal && !/^\d+(\.\d+)?$/.test(gradeVal) ? gradeVal : undefined),
          sourceType: 'sis' as const,
        },
      });
    }
  }

  // Schedule entries that don't match gradebook courses -> create course
  for (const s of extract.schedule) {
    const courseExtId = `skyward-course-${s.period}-${slugify(s.course)}`;
    const exists = extract.courses.some(
      (c) => c.period === s.period && slugify(c.name) === slugify(s.course),
    );
    if (!exists && s.course) {
      const { startTime, endTime } = parseTimeRange(s.time);
      ops.push({
        op: 'upsert',
        entity: 'course',
        key: { ...baseKey, externalId: courseExtId },
        observedAt: now,
        record: {
          title: s.course,
          teacherName: s.teacher || undefined,
          period: s.period || undefined,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          room: s.room || undefined,
        },
      });
    }
  }

  // Missing assignments -> assignment (status: missing); set termExternalId for expiration
  for (let i = 0; i < extract.missingAssignments.length; i++) {
    const ma = extract.missingAssignments[i]!;
    const course = extract.courses.find((c) => c.name === ma.course || c.period === ma.period);
    const courseExtId = course
      ? `skyward-course-${course.period}-${slugify(course.name)}`
      : `skyward-course-${ma.period}-${slugify(ma.course)}`;
    const dueDateIso = ma.dueDate ? parseDate(ma.dueDate) : undefined;
    const termExternalId = getTermExternalIdForDate(dueDateIso);

    ops.push({
      op: 'upsert',
      entity: 'assignment',
      key: { ...baseKey, externalId: `skyward-missing-${slugify(ma.title)}-${ma.period}-${dueDateIso ?? 'nodate'}`, courseExternalId: courseExtId },
      observedAt: now,
      record: {
        title: ma.title,
        dueAt: dueDateIso,
        status: 'missing' as const,
        courseExternalId: courseExtId,
        termExternalId,
      },
    });
  }

  // Graded/submitted assignments (from per-course gradebook detail)
  for (let i = 0; i < extract.assignments.length; i++) {
    const a = extract.assignments[i]!;
    const course = extract.courses.find(
      (c) => c.period === a.period || slugify(c.name) === slugify(a.course),
    );
    const courseExtId = course
      ? `skyward-course-${course.period}-${slugify(course.name)}`
      : `skyward-course-${a.period}-${slugify(a.course)}`;
    const dueDateIso = a.dueDate ? parseDate(a.dueDate) : undefined;
    const termExtId = getTermExternalIdForDate(dueDateIso ?? undefined);

    ops.push({
      op: 'upsert',
      entity: 'assignment',
      key: {
        ...baseKey,
        externalId: `skyward-assign-${a.period}-${slugify(a.title)}-${dueDateIso ?? i}`,
        courseExternalId: courseExtId,
      },
      observedAt: now,
      record: {
        title: a.title,
        dueAt: dueDateIso || undefined,
        status: a.status,
        pointsEarned: a.pointsEarned ? parseFloat(a.pointsEarned) : undefined,
        pointsPossible: a.pointsPossible ? parseFloat(a.pointsPossible) : undefined,
        category: a.category || undefined,
        courseExternalId: courseExtId,
        termExternalId: termExtId,
      },
    });
  }

  // Attendance -> attendanceEvent
  for (let i = 0; i < extract.attendance.length; i++) {
    const a = extract.attendance[i]!;
    const course = extract.courses.find((c) => c.period === a.period || c.name === a.course);
    const courseExtId = course
      ? `skyward-course-${course.period}-${slugify(course.name)}`
      : undefined;

    ops.push({
      op: 'upsert',
      entity: 'attendanceEvent',
      key: { ...baseKey, externalId: `skyward-attendance-${parseDate(a.date)}-${a.period || 'all'}` },
      observedAt: now,
      record: {
        date: parseDate(a.date),
        status: normalizeAttendanceStatus(a.status),
        periodName: a.period || undefined,
        courseName: a.course || undefined,
        courseExternalId: courseExtId || undefined,
        notes: a.reason || undefined,
      },
    });
  }

  return ops;
}

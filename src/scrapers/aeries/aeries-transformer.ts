import type { ISlcDeltaOp } from '../../core/types';

// ---------------------------------------------------------------------------
// Raw Aeries extract types (output of the Playwright scrape phase)
// ---------------------------------------------------------------------------

export interface IAeriesFullExtract {
  students: IAeriesStudentExtract[];
  timestamp: string;
}

export interface IAeriesStudentExtract {
  name: string;
  studentId: string;
  grade: string;
  school: string;
  courses: IAeriesCourseExtract[];
  attendance: IAeriesAttendanceExtract[];
}

export interface IAeriesCourseExtract {
  period: string;
  name: string;
  term: string;
  teacher: string;
  teacherEmail: string;
  room: string;
  currentGrade: number | null;
  currentPercent: number | null;
  missingCount: number;
  assignments: IAeriesAssignmentExtract[];
}

export interface IAeriesAssignmentExtract {
  number: string;
  title: string;
  category: string;
  scoreEarned: number | null;
  scorePossible: number | null;
  percentCorrect: number | null;
  dateAssigned: string;
  dateDue: string;
  dateCompleted: string;
  gradingComplete: boolean;
  isMissing: boolean;
  comment: string;
}

export interface IAeriesAttendanceExtract {
  date: string;
  period: string;
  status: string;
  reason: string;
  course: string;
}

// ---------------------------------------------------------------------------
// Transform: IAeriesFullExtract -> ISlcDeltaOp[]
// ---------------------------------------------------------------------------

export interface TransformContext {
  provider: string;
  adapterId: string;
  studentExternalId: string;
  institutionExternalId: string;
}

function normalizeAttendanceStatus(raw: string): 'present' | 'absent' | 'tardy' | 'excused' | 'unexcused' | 'partial' | 'field_trip' {
  if (!raw) return 'absent';
  const lower = raw.toLowerCase().trim();
  if (lower.includes('present') || lower.includes('p')) return 'present';
  if (lower.includes('absent') || lower.includes('abs')) return 'absent';
  if (lower.includes('tardy') || lower.includes('t')) return 'tardy';
  if (lower.includes('excused') || lower.includes('exc')) return 'excused';
  if (lower.includes('unexcused') || lower.includes('unex')) return 'unexcused';
  if (lower.includes('partial')) return 'partial';
  if (lower.includes('field') || lower.includes('trip')) return 'field_trip';
  return 'absent';
}

function parseDate(dateStr: string): string | undefined {
  if (!dateStr || !dateStr.trim()) return undefined;
  // Aeries uses MM/DD/YYYY format
  const m = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return undefined;
  const [, month, day, year] = m;
  return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
}

export function transformAeriesExtract(
  extract: IAeriesFullExtract,
  ctx: TransformContext,
): ISlcDeltaOp[] {
  const ops: ISlcDeltaOp[] = [];
  const now = extract.timestamp || new Date().toISOString();
  const asOfDate = now.split('T')[0]!;

  // Process first student (scraper config targets one student; filter happens in scraper)
  const students = extract.students;
  if (students.length === 0) return ops;

  const student = students[0]!;
  const baseKey = {
    provider: ctx.provider,
    adapterId: ctx.adapterId,
    studentExternalId: ctx.studentExternalId,
    institutionExternalId: ctx.institutionExternalId,
  };

  // Student profile
  if (student.name && student.name !== 'Unknown') {
    ops.push({
      op: 'upsert',
      entity: 'studentProfile',
      key: { ...baseKey, externalId: `aeries-profile-${student.studentId || ctx.studentExternalId}` },
      observedAt: now,
      record: {
        name: student.name,
        studentId: student.studentId || undefined,
        gradeLevel: student.grade || undefined,
        school: student.school || undefined,
      },
    });
  }

  // Courses + grade snapshots + assignments
  for (let ci = 0; ci < student.courses.length; ci++) {
    const course = student.courses[ci]!;
    const courseExtId = `aeries-course-${student.studentId || ctx.studentExternalId}-${ci}-${course.name.replace(/\s+/g, '-')}`;

    ops.push({
      op: 'upsert',
      entity: 'course',
      key: { ...baseKey, externalId: courseExtId },
      observedAt: now,
      record: {
        title: course.name,
        teacherName: course.teacher || undefined,
        teacherEmail: course.teacherEmail || undefined,
        period: course.period || undefined,
        room: course.room || undefined,
      },
    });

    // Grade snapshot per course (currentPercent -> percentGrade)
    if (course.currentPercent !== null || course.currentGrade !== null) {
      ops.push({
        op: 'upsert',
        entity: 'gradeSnapshot',
        key: { ...baseKey, externalId: `aeries-grade-${courseExtId}`, courseExternalId: courseExtId },
        observedAt: now,
        record: {
          courseExternalId: courseExtId,
          asOfDate,
          percentGrade: course.currentPercent ?? undefined,
          missingCount: course.missingCount || undefined,
        },
      });
    }

    // Assignments
    for (let ai = 0; ai < course.assignments.length; ai++) {
      const a = course.assignments[ai]!;
      const aExtId = `aeries-${courseExtId}-assignment-${ai}`;

      let status: 'missing' | 'submitted' | 'graded' | 'late' | 'not_started' | 'in_progress' | 'excused' | 'unknown' = 'unknown';
      if (a.isMissing) status = 'missing';
      else if (a.gradingComplete && a.scoreEarned !== null) status = 'graded';
      else if (a.dateCompleted) status = 'submitted';

      ops.push({
        op: 'upsert',
        entity: 'assignment',
        key: { ...baseKey, externalId: aExtId, courseExternalId: courseExtId },
        observedAt: now,
        record: {
          title: a.title,
          dueAt: parseDate(a.dateDue),
          assignedAt: parseDate(a.dateAssigned),
          status,
          pointsPossible: a.scorePossible ?? undefined,
          pointsEarned: a.scoreEarned ?? undefined,
          percentScore: a.percentCorrect ?? undefined,
          category: a.category || undefined,
          isMissing: a.isMissing,
          courseExternalId: courseExtId,
        },
      });
    }
  }

  // Attendance events
  for (let ai = 0; ai < student.attendance.length; ai++) {
    const att = student.attendance[ai]!;
    const attExtId = `aeries-attendance-${student.studentId || ctx.studentExternalId}-${ai}-${att.date}`;

    const dateStr = parseDate(att.date);
    if (!dateStr) continue;

    ops.push({
      op: 'upsert',
      entity: 'attendanceEvent',
      key: { ...baseKey, externalId: attExtId },
      observedAt: now,
      record: {
        date: dateStr,
        status: normalizeAttendanceStatus(att.status),
        periodName: att.period || undefined,
        courseName: att.course || undefined,
        notes: att.reason || undefined,
        excuseReason: att.reason || undefined,
      },
    });
  }

  return ops;
}

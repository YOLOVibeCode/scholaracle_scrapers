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
  id?: string;
  name: string;
  url?: string;
  size?: string;
  contentType?: string;
  localPath?: string;
  /** Base64-encoded image content for vision analysis (populated for small image files). */
  contentBase64?: string;
  /** AI-generated description of the image content. */
  contentDescription?: string;
}

export interface ICanvasBrowserAssignment {
  id?: string;
  name: string;
  dueDate?: string;
  points?: string;
  status?: string;
  description?: string;
  attachments?: ICanvasBrowserFile[];
}

export interface ICanvasModuleItem {
  title: string;
  type: 'Assignment' | 'File' | 'Page' | 'Discussion' | 'ExternalUrl' | 'ExternalTool' | 'SubHeader';
  contentId?: string;
  position: number;
}

export interface ICanvasBrowserModule {
  id?: string;
  name: string;
  position?: number;
  items: ICanvasModuleItem[];
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

// ---------------------------------------------------------------------------
// Material-to-Assignment matching (Layers 1 + 2)
// ---------------------------------------------------------------------------

/**
 * Match course files to assignments using two deterministic signals:
 *   Layer 1 — Canvas module structure (teacher-curated grouping)
 *   Layer 2 — File links in assignment descriptions
 *
 * Returns a Map from file name → assignment array index (as string).
 */
export function matchMaterialsToAssignments(
  course: ICanvasBrowserCourse,
): Map<string, string> {
  const fileToAssignment = new Map<string, string>();

  // Lookup: Canvas file ID → file name
  const fileIdToName = new Map<string, string>();
  for (const f of course.files) {
    if (f.id) fileIdToName.set(f.id, f.name);
  }

  // Lookup: Canvas assignment ID → assignment array index
  const assignmentIdToIndex = new Map<string, number>();
  for (let i = 0; i < course.assignments.length; i++) {
    const a = course.assignments[i]!;
    if (a.id) assignmentIdToIndex.set(a.id, i);
  }

  // --- Layer 1: Module co-occurrence ---
  for (const mod of course.modules) {
    const moduleAssignmentIds: string[] = [];
    const moduleFileIds: string[] = [];

    for (const item of mod.items) {
      if (item.type === 'Assignment' && item.contentId) {
        moduleAssignmentIds.push(item.contentId);
      }
      if (item.type === 'File' && item.contentId) {
        moduleFileIds.push(item.contentId);
      }
    }

    if (moduleFileIds.length === 0) continue;

    if (moduleAssignmentIds.length === 1) {
      // Single assignment in module → all files belong to it
      const idx = assignmentIdToIndex.get(moduleAssignmentIds[0]!);
      if (idx !== undefined) {
        for (const fid of moduleFileIds) {
          const fname = fileIdToName.get(fid);
          if (fname && !fileToAssignment.has(fname)) {
            fileToAssignment.set(fname, String(idx));
          }
        }
      }
    } else if (moduleAssignmentIds.length > 1) {
      // Multiple assignments → assign files to nearest preceding assignment by position
      const sorted = [...mod.items].sort((a, b) => a.position - b.position);
      let currentIdx: number | undefined;
      for (const item of sorted) {
        if (item.type === 'Assignment' && item.contentId) {
          currentIdx = assignmentIdToIndex.get(item.contentId);
        } else if (item.type === 'File' && item.contentId && currentIdx !== undefined) {
          const fname = fileIdToName.get(item.contentId);
          if (fname && !fileToAssignment.has(fname)) {
            fileToAssignment.set(fname, String(currentIdx));
          }
        }
      }
    }
  }

  // --- Layer 2: Assignment description link extraction ---
  for (let i = 0; i < course.assignments.length; i++) {
    const a = course.assignments[i]!;
    if (!a.description) continue;

    // Match Canvas file URLs: /files/{fileId}
    const fileIdPattern = /\/files\/(\d+)/g;
    let match: RegExpExecArray | null;
    while ((match = fileIdPattern.exec(a.description)) !== null) {
      const fileId = match[1]!;
      const fname = fileIdToName.get(fileId);
      if (fname && !fileToAssignment.has(fname)) {
        fileToAssignment.set(fname, String(i));
      }
    }

    // Match by filename mentioned verbatim in description
    for (const file of course.files) {
      const nameNoExt = file.name.replace(/\.[^.]+$/, '');
      if (nameNoExt.length >= 4 && a.description.includes(file.name)) {
        if (!fileToAssignment.has(file.name)) {
          fileToAssignment.set(file.name, String(i));
        }
      }
    }
  }

  return fileToAssignment;
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

    // Match course files to assignments via modules + description links
    const materialMatches = matchMaterialsToAssignments(course);

    for (const file of course.files) {
      const matchedIdx = materialMatches.get(file.name);
      const assignmentExternalId = matchedIdx !== undefined
        ? `canvas-${course.id}-assignment-${matchedIdx}`
        : undefined;

      ops.push({
        op: 'upsert',
        entity: 'courseMaterial',
        key: { ...baseKey, externalId: `canvas-file-${course.id}-${file.name}`, courseExternalId: courseExtId },
        observedAt: now,
        record: {
          title: file.name,
          courseExternalId: courseExtId,
          assignmentExternalId,
          type: 'document' as const,
          url: file.url,
          fileName: file.name,
          mimeType: file.contentType || undefined,
          extractedText: file.contentDescription || undefined,
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

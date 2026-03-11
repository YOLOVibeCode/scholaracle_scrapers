/**
 * Scholaracle Ingest Types — standalone copy of @scholaracle/contracts
 *
 * Canonical source: Scholaracle monorepo packages/contracts/src/models/Ingest.ts
 * (published as @scholaracle/contracts). This file is a standalone copy so the
 * scraper library has zero monorepo dependencies and can be used independently.
 */

// ---------------------------------------------------------------------------
// Schema constants
// ---------------------------------------------------------------------------

export const SLC_INGEST_SCHEMA_VERSION_V1 = 'slc.ingest.v1' as const;

export type SlcSchemaVersion = typeof SLC_INGEST_SCHEMA_VERSION_V1;

export type SlcIngestMode = 'delta';

// ---------------------------------------------------------------------------
// Entity types
// ---------------------------------------------------------------------------

export type SlcEntityType =
  | 'assignment'
  | 'eventSeries'
  | 'eventOverride'
  | 'academicTerm'
  | 'institution'
  | 'course'
  | 'gradeSnapshot'
  | 'attendanceEvent'
  | 'teacher'
  | 'courseMaterial'
  | 'message'
  | 'studentProfile';

export const SLC_ENTITY_TYPES: readonly SlcEntityType[] = [
  'assignment',
  'eventSeries',
  'eventOverride',
  'academicTerm',
  'institution',
  'course',
  'gradeSnapshot',
  'attendanceEvent',
  'teacher',
  'courseMaterial',
  'message',
  'studentProfile',
] as const;

export type SlcOpType = 'upsert' | 'delete';

// ---------------------------------------------------------------------------
// Envelope structure
// ---------------------------------------------------------------------------

export interface ISlcEntityKey {
  readonly provider: string;
  readonly adapterId: string;
  readonly externalId: string;
  readonly studentExternalId?: string;
  readonly institutionExternalId?: string;
  readonly courseExternalId?: string;
  readonly termExternalId?: string;
}

export interface ISlcCursorOpaque {
  readonly type: 'opaque';
  readonly value: string;
  readonly capturedAt?: string;
}

export type ISlcCursor = ISlcCursorOpaque;

export interface ISlcRunMeta {
  readonly runId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly provider: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly mode: SlcIngestMode;
  readonly timezone: string;
}

export interface ISlcSourceMeta {
  readonly sourceId: string;
  readonly displayName: string;
  readonly portalBaseUrl?: string;
}

export interface ISlcDeltaOp<TRecord = Record<string, unknown>> {
  readonly op: SlcOpType;
  readonly entity: SlcEntityType;
  readonly key: ISlcEntityKey;
  readonly observedAt: string;
  readonly record?: TRecord;
}

export interface ISlcIngestEnvelopeV1 {
  readonly schemaVersion: SlcSchemaVersion;
  readonly run: ISlcRunMeta;
  readonly source: ISlcSourceMeta;
  readonly cursor?: ISlcCursor;
  readonly ops: readonly ISlcDeltaOp[];
  readonly stats?: Record<string, number>;
  readonly warnings?: readonly string[];
}

// ---------------------------------------------------------------------------
// Shared supporting types
// ---------------------------------------------------------------------------

export interface ISlcRubricScore {
  readonly criterion: string;
  readonly score?: number;
  readonly possiblePoints?: number;
  readonly rating?: string;
  readonly comments?: string;
}

export interface ISlcAttachment {
  readonly name: string;
  readonly url?: string;
  readonly type?: string;
  readonly size?: number;
}

export interface ISlcGradeCategory {
  readonly name: string;
  readonly weight: number;
  readonly earnedPoints?: number;
  readonly possiblePoints?: number;
  readonly percentScore?: number;
  readonly letterGrade?: string;
}

// ---------------------------------------------------------------------------
// Entity shapes
// ---------------------------------------------------------------------------

export interface ISlcAssignment {
  readonly title: string;
  readonly description?: string;
  readonly dueAt?: string;
  readonly assignedAt?: string;
  readonly status?: 'missing' | 'submitted' | 'graded' | 'late' | 'not_started' | 'in_progress' | 'excused' | 'unknown';
  readonly pointsPossible?: number;
  readonly pointsEarned?: number;
  readonly percentScore?: number;
  readonly letterGrade?: string;
  readonly category?: string;
  readonly categoryWeight?: number;
  readonly submittedAt?: string;
  readonly gradedAt?: string;
  readonly teacherFeedback?: string;
  readonly rubricScores?: readonly ISlcRubricScore[];
  readonly isLate?: boolean;
  readonly isMissing?: boolean;
  readonly isExcused?: boolean;
  readonly turnedInLateBy?: string;
  readonly attachments?: readonly ISlcAttachment[];
  readonly submissionType?: string;
  readonly url?: string;
  readonly courseExternalId?: string;
  readonly termExternalId?: string;
}

export interface ISlcEventSeries {
  readonly title: string;
  readonly category: 'test' | 'quiz' | 'classwork' | 'project' | 'meeting' | 'field_trip' | 'activity' | 'deadline' | 'other';
  readonly timezone: string;
  readonly startsAt: string;
  readonly endsAt?: string;
  readonly durationMinutes?: number;
  readonly recurrence: {
    readonly rrule: string;
    readonly until?: string;
    readonly count?: number;
    readonly exDates?: readonly string[];
  };
}

export interface ISlcEventOverride {
  readonly seriesExternalId: string;
  readonly occurrenceStartAt: string;
  readonly op: 'modify' | 'cancel';
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly title?: string;
  readonly category?: ISlcEventSeries['category'];
}

export interface ISlcCourse {
  readonly title: string;
  readonly courseCode?: string;
  readonly subjectArea?: string;
  readonly teacherName?: string;
  readonly teacherEmail?: string;
  readonly period?: string;
  readonly room?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly daysOfWeek?: readonly number[];
  readonly termExternalId?: string;
  readonly description?: string;
  readonly url?: string;
}

/**
 * Academic term: year, semester, quarter, or grading period.
 * Hierarchy: year → semesters (e.g. 2) → grading periods (e.g. 3–4 per semester).
 */
export interface ISlcAcademicTerm {
  readonly title: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly type?: 'semester' | 'quarter' | 'trimester' | 'year' | 'grading_period' | 'other';
  /** Parent term's externalId (e.g. grading period → semester, semester → year). */
  readonly parentTermExternalId?: string;
}

export interface ISlcGradeSnapshot {
  readonly courseExternalId: string;
  readonly termExternalId?: string;
  readonly letterGrade?: string;
  readonly percentGrade?: number;
  readonly gpa?: number;
  readonly asOfDate: string;
  readonly earnedPoints?: number;
  readonly possiblePoints?: number;
  readonly missingCount?: number;
  readonly lateCount?: number;
  readonly categories?: readonly ISlcGradeCategory[];
  readonly trend?: 'improving' | 'declining' | 'stable' | 'unknown';
  readonly classAverage?: number;
  readonly classRank?: string;
  readonly teacherComments?: string;
  /** 'sis' = Student Information System (Skyward, Aeries) — grade of record.
   *  'lms' = Learning Management System (Canvas) — teacher's running gradebook. */
  readonly sourceType?: 'sis' | 'lms';
}

export interface ISlcAttendanceEvent {
  readonly date: string;
  readonly status: 'present' | 'absent' | 'tardy' | 'excused' | 'unexcused' | 'partial' | 'field_trip';
  readonly periodName?: string;
  readonly courseName?: string;
  readonly courseExternalId?: string;
  readonly notes?: string;
  readonly minutesMissed?: number;
  readonly excuseReason?: string;
}

export interface ISlcInstitution {
  readonly name: string;
  readonly type?: 'school' | 'district' | 'other';
  readonly address?: string;
}

export interface ISlcTeacher {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly department?: string;
  readonly title?: string;
  readonly officeHours?: string;
  readonly preferredContact?: string;
  readonly courseExternalIds?: readonly string[];
}

export interface ISlcCourseMaterial {
  readonly title: string;
  readonly courseExternalId: string;
  readonly type: 'document' | 'link' | 'syllabus' | 'handout' | 'rubric' | 'study_guide' | 'presentation' | 'video' | 'other';
  readonly url?: string;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly postedAt?: string;
  readonly description?: string;
  readonly extractedText?: string;
  readonly fileSize?: number;
}

export interface ISlcMessage {
  readonly subject: string;
  readonly body: string;
  readonly senderName: string;
  readonly senderRole?: 'teacher' | 'admin' | 'counselor' | 'system' | 'parent' | 'student';
  readonly sentAt: string;
  readonly read?: boolean;
  readonly courseExternalId?: string;
  readonly attachments?: readonly ISlcAttachment[];
  readonly recipients?: string;
  readonly importance?: 'normal' | 'important' | 'urgent';
  readonly category?: 'academic' | 'administrative' | 'event' | 'reminder' | 'behavioral' | 'other';
}

export interface ISlcStudentProfile {
  readonly name: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly studentId?: string;
  readonly gradeLevel?: string;
  readonly school?: string;
  readonly district?: string;
  readonly enrollmentStatus?: string;
  readonly counselor?: string;
  readonly advisor?: string;
  readonly homeroom?: string;
}

// ---------------------------------------------------------------------------
// Scraper progress / status reporting
// ---------------------------------------------------------------------------

export type ScraperPhase =
  | 'initializing'
  | 'authenticating'
  | 'discovering_students'
  | 'switching_student'
  | 'scraping'
  | 'transforming'
  | 'processing_assets'
  | 'validating'
  | 'uploading'
  | 'cleanup'
  | 'completed'
  | 'failed';

export interface IScraperProgress {
  readonly phase: ScraperPhase;
  readonly message: string;
  readonly timestamp: string;
  readonly durationMs?: number;
  readonly detail?: Record<string, unknown>;
}

export type ScraperProgressCallback = (progress: IScraperProgress) => void;

// ---------------------------------------------------------------------------
// Scraper configuration types (specific to this library)
// ---------------------------------------------------------------------------

export interface IScraperMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author?: string;
  readonly description: string;
  readonly platforms: readonly string[];
  readonly capabilities: {
    readonly grades: boolean;
    readonly assignments: boolean;
    readonly attendance: boolean;
    readonly schedule: boolean;
    readonly messages: boolean;
    readonly documents: boolean;
  };
}

export interface IScraperCredentials {
  readonly baseUrl: string;
  readonly username?: string;
  readonly password?: string;
  readonly accessToken?: string;
  readonly loginMethod?: 'direct' | 'google_sso' | 'clever_sso' | 'other_sso';
  /** Optional hint when the portal shows one student (single-student portals). */
  readonly studentNameHint?: string;
}

/** Result of discoverStudents() for connection-centric scrapers (e.g. one login → many kids). */
export interface IDiscoveredStudent {
  readonly externalId: string;
  readonly displayName?: string;
}

export interface IScraperConfig {
  readonly credentials: IScraperCredentials;
  readonly studentName: string;
  readonly studentExternalId: string;
  readonly institutionExternalId: string;
  readonly sourceId: string;
  readonly provider: string;
  readonly adapterId: string;
  readonly options?: {
    readonly headless?: boolean;
    readonly timeout?: number;
    readonly retries?: number;
    readonly skipDownloads?: boolean;
    readonly maxConcurrentDownloads?: number;
    readonly assetSizeLimit?: number;
  };
}

// ---------------------------------------------------------------------------
// Asset management types (scraper client)
// ---------------------------------------------------------------------------

export interface IAssetDescriptor {
  readonly originalUrl: string;
  readonly fileName: string;
  readonly mimeType?: string;
  readonly fileSize?: number;
  readonly entityType: 'courseMaterial' | 'assignment' | 'message';
  readonly entityExternalId: string;
  readonly courseExternalId?: string;
  /** Term (semester/quarter/grading period) the subject belongs to; used for term-based pruning. */
  readonly academicTermId?: string;
}

export interface IAssetManifestEntry {
  readonly originalUrl: string;
  readonly contentHash: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly serverAssetId: string;
  readonly serverUrl: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly uploadedAt: string;
  readonly academicTermId?: string;
}

export interface IAssetManifest {
  readonly sourceId: string;
  readonly provider: string;
  readonly lastUpdated: string;
  readonly entries: Record<string, IAssetManifestEntry>;
}

export interface IDownloadResult {
  readonly descriptor: IAssetDescriptor;
  readonly localPath: string;
  readonly contentHash: string;
  readonly fileSize: number;
  readonly skipped: boolean;
  readonly cachedServerUrl?: string;
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface IUploadedAsset {
  readonly serverAssetId: string;
  readonly serverUrl: string;
  readonly originalUrl: string;
  readonly contentHash: string;
}

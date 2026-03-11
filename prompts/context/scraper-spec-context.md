# Scholaracle Scraper Specification — AI Context Document

> Paste this entire document as context when asking an AI to create or modify a Scholaracle scraper.

## What Is This?

Scholaracle scrapers are Playwright-based browser automation scripts that log into
educational platforms (Canvas, Aeries, Skyward, etc.), extract student academic data,
and upload it to the Scholaracle API in a normalized format called `ISlcIngestEnvelopeV1`.

## Architecture

```
User's Machine                              Scholaracle Server
┌──────────────────────────────┐           ┌──────────────────┐
│  BaseScraper subclass        │           │                  │
│    initialize() → browser    │           │  Ingest API      │
│    authenticate() → login    │           │  POST /runs      │
│    scrape() → raw data       │           │  POST /envelope  │
│    transform() → ISlcDeltaOp[]│──────────▶│  POST /complete  │
│    cleanup() → close browser │           │                  │
└──────────────────────────────┘           └──────────────────┘
```

## BaseScraper Interface

```typescript
abstract class BaseScraper {
  config: IScraperConfig | undefined;

  abstract get metadata(): IScraperMetadata;
  abstract initialize(config: IScraperConfig): Promise<void>;
  abstract authenticate(): Promise<{ success: boolean; message?: string }>;
  abstract scrape(): Promise<Record<string, unknown>>;
  abstract transform(rawData: Record<string, unknown>): ISlcDeltaOp[];
  abstract cleanup(): Promise<void>;

  // Provided by base class:
  async run(config: IScraperConfig): Promise<ISlcIngestEnvelopeV1>;
  assembleEnvelope(ops: ISlcDeltaOp[]): ISlcIngestEnvelopeV1;
}
```

## ISlcIngestEnvelopeV1 Schema

```typescript
interface ISlcIngestEnvelopeV1 {
  schemaVersion: 'slc.ingest.v1';
  run: {
    runId: string;          // UUID
    startedAt: string;      // ISO timestamp
    endedAt?: string;       // ISO timestamp
    provider: string;       // e.g., "canvas"
    adapterId: string;      // e.g., "canvas-browser"
    adapterVersion: string; // e.g., "1.0.0"
    mode: 'delta';
    timezone: string;       // IANA tz, e.g., "America/Chicago"
  };
  source: {
    sourceId: string;       // Unique per student+platform
    displayName: string;    // Human-readable name
    portalBaseUrl?: string; // Login URL
  };
  ops: ISlcDeltaOp[];       // Array of upsert/delete operations
}

interface ISlcDeltaOp {
  op: 'upsert' | 'delete';
  entity: SlcEntityType;    // One of the 12 types below
  key: {
    provider: string;
    adapterId: string;
    externalId: string;     // Unique ID for this record
    studentExternalId?: string;
    institutionExternalId?: string;
    courseExternalId?: string;
    termExternalId?: string;
  };
  observedAt: string;       // ISO timestamp
  record?: Record<string, unknown>; // Entity data (required for upsert)
}
```

## 12 Entity Types

### 1. studentProfile
```typescript
{ name: string; firstName?: string; lastName?: string;
  studentId?: string; gradeLevel?: string; school?: string;
  district?: string; enrollmentStatus?: string; counselor?: string; }
```

### 2. course
```typescript
{ title: string; courseCode?: string; subjectArea?: string;
  teacherName?: string; teacherEmail?: string; period?: string;
  room?: string; startTime?: string; endTime?: string;
  daysOfWeek?: number[]; description?: string; url?: string; }
```

### 3. assignment
```typescript
{ title: string; description?: string; dueAt?: string; assignedAt?: string;
  status?: 'missing'|'submitted'|'graded'|'late'|'not_started'|'in_progress'|'excused'|'unknown';
  pointsPossible?: number; pointsEarned?: number; percentScore?: number;
  letterGrade?: string; category?: string; categoryWeight?: number;
  submittedAt?: string; gradedAt?: string; teacherFeedback?: string;
  rubricScores?: Array<{criterion:string; score?:number; possiblePoints?:number; rating?:string; comments?:string}>;
  isLate?: boolean; isMissing?: boolean; isExcused?: boolean;
  attachments?: Array<{name:string; url?:string; type?:string; size?:number}>;
  submissionType?: string; url?: string; courseExternalId?: string; }
```

### 4. gradeSnapshot
```typescript
{ courseExternalId: string; asOfDate: string; letterGrade?: string;
  percentGrade?: number; gpa?: number; earnedPoints?: number;
  possiblePoints?: number; missingCount?: number; lateCount?: number;
  categories?: Array<{name:string; weight:number; earnedPoints?:number; possiblePoints?:number; percentScore?:number}>;
  trend?: 'improving'|'declining'|'stable'|'unknown';
  classAverage?: number; classRank?: string; teacherComments?: string; }
```

### 5. attendanceEvent
```typescript
{ date: string; status: 'present'|'absent'|'tardy'|'excused'|'unexcused'|'partial'|'field_trip';
  periodName?: string; courseName?: string; courseExternalId?: string;
  notes?: string; minutesMissed?: number; excuseReason?: string; }
```

### 6. teacher
```typescript
{ name: string; email?: string; phone?: string; department?: string;
  title?: string; officeHours?: string; preferredContact?: string;
  courseExternalIds?: string[]; }
```

### 7. courseMaterial
```typescript
{ title: string; courseExternalId: string;
  type: 'document'|'link'|'syllabus'|'handout'|'rubric'|'study_guide'|'presentation'|'video'|'other';
  url?: string; fileName?: string; mimeType?: string;
  postedAt?: string; description?: string; extractedText?: string; fileSize?: number; }
```

### 8. message
```typescript
{ subject: string; body: string; senderName: string;
  senderRole?: 'teacher'|'admin'|'counselor'|'system'|'parent'|'student';
  sentAt: string; read?: boolean; courseExternalId?: string;
  attachments?: Array<{name:string; url?:string; type?:string}>;
  recipients?: string; importance?: 'normal'|'important'|'urgent';
  category?: 'academic'|'administrative'|'event'|'reminder'|'behavioral'|'other'; }
```

### 9. academicTerm
```typescript
{ title: string; startDate: string; endDate: string;
  type?: 'semester'|'quarter'|'trimester'|'year'|'other'; }
```

### 10. institution
```typescript
{ name: string; type?: 'school'|'district'|'other'; address?: string; }
```

### 11. eventSeries
```typescript
{ title: string; category: 'test'|'quiz'|'classwork'|'project'|'meeting'|'field_trip'|'activity'|'deadline'|'other';
  timezone: string; startsAt: string; endsAt?: string; durationMinutes?: number;
  recurrence: { rrule: string; until?: string; count?: number; }; }
```

### 12. eventOverride
```typescript
{ seriesExternalId: string; occurrenceStartAt: string;
  op: 'modify'|'cancel'; startsAt?: string; title?: string; }
```

## Data Extraction Rule

**If the platform shows it on any page, scrape it.**

Navigate to EVERY page necessary. For each assignment, navigate into its detail page
to get the description, rubric scores, and teacher feedback. These are usually not
visible on the list view.

## Scraper File Structure

```
src/scrapers/{platform}/
├── metadata.json              # Platform descriptor
├── {platform}-scraper.ts      # BaseScraper subclass with Playwright logic
└── {platform}-transformer.ts  # Pure function: raw data → ISlcDeltaOp[]
```

## Common Playwright Patterns

```typescript
// Login
await page.fill('#username', credentials.username);
await page.fill('#password', credentials.password);
await page.click('button[type="submit"]');
await page.waitForLoadState('networkidle');

// Google SSO
await page.fill('input[type="email"]', email);
await page.click('#identifierNext button');
await page.fill('input[type="password"]', password);
await page.click('#passwordNext button');
await page.waitForURL(url => !url.hostname.includes('google'));

// Extract data from page
const data = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.item')).map(el => ({
    title: el.querySelector('.title')?.textContent?.trim(),
    value: el.querySelector('.value')?.textContent?.trim(),
  }));
});

// Handle popups (Skyward)
context.on('page', (popup) => { /* use popup instead of page */ });

// Wait for dynamic content
await page.waitForSelector('.data-loaded', { timeout: 10000 });
```

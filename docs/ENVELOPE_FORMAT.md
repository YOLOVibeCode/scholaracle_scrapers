# Envelope Format

Every scraper produces an `ISlcIngestEnvelopeV1` — a JSON object containing a list of delta operations that describe what changed in the student's academic data.

## Envelope structure

```jsonc
{
  "schema": "slc.ingest.v1",
  "mode": "delta",
  "source": {
    "provider": "canvas",
    "adapterId": "com.instructure.canvas",
    "sourceId": "src-abc123"
  },
  "student": {
    "externalId": "stu-emma-lewis",
    "institutionExternalId": "inst-lincoln-isd"
  },
  "generatedAt": "2026-02-19T12:00:00.000Z",
  "ops": [
    {
      "op": "upsert",
      "entity": "course",
      "key": {
        "provider": "canvas",
        "adapterId": "com.instructure.canvas",
        "externalId": "course-math-101",
        "studentExternalId": "stu-emma-lewis",
        "institutionExternalId": "inst-lincoln-isd"
      },
      "observedAt": "2026-02-19T12:00:00.000Z",
      "record": {
        "title": "Pre-AP Math"
      }
    }
  ]
}
```

## Operations

Each op is one of:

| `op` | Meaning |
|------|---------|
| `upsert` | Create or update an entity. `key` identifies it; `record` contains the data. |
| `delete` | Remove an entity. `key` identifies it; no `record` needed. |

## Key fields (every op)

```typescript
interface ISlcDeltaKey {
  provider: string;          // e.g. "canvas", "aeries", "skyward"
  adapterId: string;         // e.g. "com.instructure.canvas"
  externalId: string;        // unique ID for this entity within the provider
  studentExternalId: string;
  institutionExternalId: string;
  courseExternalId?: string;  // required for assignment, gradeSnapshot, courseMaterial
}
```

- **provider** + **adapterId** identify the source system.
- **externalId** is the entity's unique ID within that system (e.g., the Canvas course ID).
- **studentExternalId** ties the data to a specific student.
- **courseExternalId** links assignments, grades, and materials to a course.

## Entity types and required record fields

### `studentProfile`
```jsonc
{ "name": "Emma Lewis" }
```

### `institution`
```jsonc
{ "name": "Lincoln ISD" }
```

### `course`
```jsonc
{ "title": "Pre-AP Math" }
// Optional: teacherName, courseCode, url
```

### `assignment`
```jsonc
{
  "title": "Chapter 5 Review",
  "courseExternalId": "course-math-101"
  // Optional: dueAt, pointsPossible, pointsEarned, status, description, url, category, submittedAt
}
```

Status values: `"submitted"`, `"missing"`, `"late"`, `"graded"`, `"not_submitted"`, `"excused"`.

### `gradeSnapshot`
```jsonc
{
  "courseExternalId": "course-math-101",
  "asOfDate": "2026-02-19"
  // Optional: letterGrade, percentage, gpa, totalPoints, earnedPoints
}
```

### `attendanceEvent`
```jsonc
{
  "date": "2026-02-19",
  "status": "present"
  // Optional: period, courseExternalId, note, minutesMissed
}
```

Status values: `"present"`, `"absent"`, `"tardy"`, `"excused"`.

### `teacher`
```jsonc
{
  "name": "Mr. Johnson"
  // Optional: email, courseExternalIds
}
```

### `courseMaterial`
```jsonc
{
  "title": "Syllabus",
  "courseExternalId": "course-math-101",
  "type": "document"
  // Optional: url, description, publishedAt
}
```

Type values: `"document"`, `"link"`, `"file"`, `"video"`, `"image"`.

### `message`
```jsonc
{
  "subject": "Welcome to class",
  "body": "Hello students...",
  "senderName": "Mr. Johnson",
  "sentAt": "2026-02-01T08:00:00Z"
  // Optional: courseExternalId, recipientType, url, attachments
}
```

### `academicTerm`
```jsonc
{
  "title": "Fall 2025",
  "startDate": "2025-08-15",
  "endDate": "2025-12-20"
  // Optional: type ("school_year", "semester", "quarter", "trimester", "grading_period")
  // Optional: parentTermExternalId (links to parent in hierarchy)
}
```

### `eventSeries`
```jsonc
{
  "title": "Math tutoring"
  // Optional: rrule, startTime, endTime, location, description, courseExternalId
}
```

### `eventOverride`
```jsonc
{
  "seriesExternalId": "event-math-tutoring"
  // Optional: date, cancelled, startTime, endTime, title, location, description
}
```

## Validation

Before upload, the envelope is validated by `validateEnvelope()` from `src/core/validator.ts`. It checks:

- Schema version is `slc.ingest.v1`
- Every op has a valid entity type, key fields, and `observedAt`
- Required record fields are present per entity type
- No duplicate keys in the same envelope

Use `npx scholaracle-scraper validate` to run validation without uploading.

## TransformContext

Transformers receive a `TransformContext` to avoid hardcoding key fields:

```typescript
interface TransformContext {
  provider: string;
  adapterId: string;
  studentExternalId: string;
  institutionExternalId: string;
}
```

This is passed to the transformer by `BaseScraper` and should be used to build all `key` objects.

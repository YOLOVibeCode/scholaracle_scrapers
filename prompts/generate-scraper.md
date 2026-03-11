# Generate a Scholaracle Scraper

## Instructions for AI

I need you to create a Playwright-based browser scraper for the Scholaracle Scraper Library.
The scraper must follow the BaseScraper pattern and produce `ISlcDeltaOp[]` operations that
conform to the `ISlcIngestEnvelopeV1` schema.

## Platform Details

- **Platform name:** [e.g., ParentSquare, PowerSchool, Infinite Campus]
- **Login URL:** [e.g., https://www.parentsquare.com/signin]
- **Login method:** [email + password / Google SSO / Clever SSO / other]
- **Data I need:** [grades, assignments, attendance, messages, documents — list all]
- **Student name:** [for key generation]
- **Any special notes:** [e.g., uses popup windows, has CAPTCHA, requires 2FA]

## What You Must Create

Create three files in `src/scrapers/[platform-name]/`:

### 1. `metadata.json`
```json
{
  "id": "[platform]-browser",
  "name": "[Platform Name]",
  "version": "1.0.0",
  "description": "Scrapes student data from [Platform Name]",
  "platforms": ["*.[domain].com"],
  "capabilities": {
    "grades": true/false,
    "assignments": true/false,
    "attendance": true/false,
    "schedule": true/false,
    "messages": true/false,
    "documents": true/false
  }
}
```

### 2. `[platform]-transformer.ts`

- Define raw extract interfaces (what your scraper produces)
- Export `transform[Platform]Extract(extract, ctx)` that maps raw data to `ISlcDeltaOp[]`
- Map to ALL applicable entity types: `studentProfile`, `course`, `gradeSnapshot`, `assignment`, `attendanceEvent`, `teacher`, `courseMaterial`, `message`, `academicTerm`, `institution`

### 3. `[platform]-scraper.ts`

- Extend `BaseScraper` from `../../core/base-scraper`
- Implement `initialize()`, `authenticate()`, `scrape()`, `transform()`, `cleanup()`
- Use Playwright for browser automation
- Follow the Data Extraction Checklist: **scrape EVERYTHING the platform shows**

## Required Entity Types and Fields

### assignment (REQUIRED for every graded item)
- title (REQUIRED), description, dueAt, assignedAt, status, pointsPossible, pointsEarned
- percentScore, letterGrade, category, categoryWeight
- submittedAt, gradedAt, teacherFeedback, rubricScores
- isLate, isMissing, isExcused, attachments, courseExternalId

### gradeSnapshot (one per course)
- courseExternalId (REQUIRED), asOfDate (REQUIRED), letterGrade, percentGrade
- earnedPoints, possiblePoints, missingCount, lateCount
- categories (name, weight, percentScore per category)

### course
- title (REQUIRED), courseCode, subjectArea, teacherName, teacherEmail
- period, room, startTime, endTime, url

### studentProfile
- name (REQUIRED), firstName, lastName, studentId, gradeLevel, school

### attendanceEvent
- date (REQUIRED), status (REQUIRED), periodName, courseName, minutesMissed

### teacher
- name (REQUIRED), email, phone, department, officeHours

### courseMaterial
- title (REQUIRED), courseExternalId (REQUIRED), type (REQUIRED), url, fileName

### message
- subject (REQUIRED), body (REQUIRED), senderName (REQUIRED), sentAt (REQUIRED)
- senderRole, importance, category, attachments

## Key Pattern

Every op must have this structure:
```typescript
{
  op: 'upsert',
  entity: 'assignment',  // one of the 12 entity types
  key: {
    provider: config.provider,
    adapterId: config.adapterId,
    externalId: 'unique-id-for-this-item',
    studentExternalId: config.studentExternalId,
    institutionExternalId: config.institutionExternalId,
    courseExternalId: 'optional-link-to-course',
  },
  observedAt: new Date().toISOString(),
  record: { /* entity-specific fields */ }
}
```

## Reference

See `src/scrapers/canvas/` for a complete working example.
See `context/scraper-spec-context.md` for the full specification.

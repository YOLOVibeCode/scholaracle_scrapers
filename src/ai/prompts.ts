/**
 * AI prompt engineering for scraper generation and troubleshooting.
 *
 * The system prompt embeds the full Scholaracle scraper specification,
 * entity type schema, and extraction checklist so the AI has complete
 * context for generating compliant scrapers.
 */

export function getSystemPrompt(): string {
  return `You are a Scholaracle scraper engineer. You create Playwright-based browser scrapers
that extract student academic data from educational platforms and produce ISlcDeltaOp[]
operations conforming to the ISlcIngestEnvelopeV1 schema.

## Architecture

Every scraper extends BaseScraper and implements:
- initialize(config) — set up Playwright browser
- authenticate() — log into the school portal
- scrape() — extract raw data from platform pages
- transform(rawData) — pure function converting raw data to ISlcDeltaOp[]
- cleanup() — close browser

The base class provides run() which orchestrates the lifecycle and assembleEnvelope()
which wraps ops in an ISlcIngestEnvelopeV1.

## File Structure

Each scraper lives in src/scrapers/{platform}/ with three files:
- metadata.json — platform descriptor
- {platform}-scraper.ts — BaseScraper subclass with Playwright logic
- {platform}-transformer.ts — pure transform function + raw extract types

## ISlcDeltaOp Structure

Every op must have:
{
  op: 'upsert',
  entity: '<one of 12 entity types>',
  key: {
    provider: config.provider,
    adapterId: config.adapterId,
    externalId: '<unique ID for this record>',
    studentExternalId: config.studentExternalId,
    institutionExternalId: config.institutionExternalId,
    courseExternalId: '<optional link to course>',
  },
  observedAt: '<ISO timestamp>',
  record: { /* entity-specific fields */ }
}

## 12 Entity Types (extract ALL that the platform supports)

1. studentProfile: { name(req), firstName, lastName, studentId, gradeLevel, school, district }
2. course: { title(req), courseCode, subjectArea, teacherName, teacherEmail, period, room, startTime, endTime, url }
3. assignment: { title(req), description, dueAt, assignedAt, status, pointsPossible, pointsEarned, percentScore, letterGrade, category, categoryWeight, submittedAt, gradedAt, teacherFeedback, rubricScores[], isLate, isMissing, attachments[], courseExternalId }
4. gradeSnapshot: { courseExternalId(req), asOfDate(req), letterGrade, percentGrade, earnedPoints, possiblePoints, missingCount, lateCount, categories[], trend, classAverage, teacherComments }
5. attendanceEvent: { date(req), status(req: present|absent|tardy|excused|unexcused|partial|field_trip), periodName, courseName, minutesMissed, excuseReason }
6. teacher: { name(req), email, phone, department, title, officeHours, preferredContact, courseExternalIds[] }
7. courseMaterial: { title(req), courseExternalId(req), type(req: document|link|syllabus|handout|rubric|study_guide|presentation|video|other), url, fileName, description, extractedText }
8. message: { subject(req), body(req), senderName(req), sentAt(req), senderRole, read, importance, category, attachments[] }
9. academicTerm: { title(req), startDate(req), endDate(req), type }
10. institution: { name(req), type, address }
11. eventSeries: { title(req), category, timezone, startsAt, recurrence.rrule }
12. eventOverride: { seriesExternalId(req), occurrenceStartAt, op: modify|cancel }

## Critical Rule

If the platform shows data on ANY page, scrape it. Navigate to every page necessary.
For each assignment, navigate into its detail page to get description, rubric, and teacher feedback.

## Playwright Patterns

- Login: page.fill('#email', creds.username) -> page.click('button[type="submit"]')
- Google SSO: fill email -> Next -> fill password -> Next -> waitForURL
- Extract: page.evaluate(() => { return Array.from(document.querySelectorAll(...)) })
- Popups: context.on('page', popup => { /* use popup */ })
- Wait: page.waitForSelector('.loaded', { timeout: 10000 })
- Navigate: page.goto(url, { waitUntil: 'networkidle' })

## Import Paths

- BaseScraper from '../../core/base-scraper'
- Types from '../../core/types'
- Transformer from './{platform}-transformer'
- metadata from './metadata.json'`;
}

export function getGeneratePrompt(userRequest: string): string {
  return `Generate a complete Scholaracle scraper based on this request:

${userRequest}

Create all three files:
1. metadata.json
2. {platform}-transformer.ts (with raw extract types + transformFunction)
3. {platform}-scraper.ts (extending BaseScraper with full Playwright implementation)

Output each file with a clear filename header like:
--- metadata.json ---
(content)

--- platform-transformer.ts ---
(content)

--- platform-scraper.ts ---
(content)

Make the scraper extract EVERYTHING the platform shows: student info, courses, grades,
assignments (with descriptions and feedback), attendance, teachers, documents, messages.
Navigate into every detail page. Handle errors gracefully — one failed page should not
prevent scraping other pages.`;
}

export function getTroubleshootPrompt(error: string, scraperCode: string): string {
  return `A Scholaracle scraper is failing. Diagnose the issue and provide a fix.

## Error Message
\`\`\`
${error}
\`\`\`

## Scraper Code
\`\`\`typescript
${scraperCode}
\`\`\`

## Common Issues
- TimeoutError on selector: page structure changed, update selectors
- Auth failure: CAPTCHA, 2FA, changed login flow
- Empty data: wrong page or wrong selectors
- Shadow DOM: use page.locator('host').locator('input')
- Popup windows: listen for context.on('page')
- Rate limiting: add waitForTimeout between requests

Provide:
1. Root cause analysis
2. Specific code fix (show the exact lines to change)
3. How to prevent this in the future`;
}

export function getAdvisorPrompt(studentContext: string): string {
  return `A parent needs help supporting their child academically. Based on the data below,
create a prioritized action plan. Focus on what they can do THIS WEEK.

${studentContext}

For each at-risk course, provide:
1. What's happening (the data)
2. Why it matters (context)
3. Specific next steps (contact teacher, set up tutoring, work on missing assignments, etc.)
4. A timeline (what to do today, this week, ongoing)

Also identify:
- Missing assignments that can still be turned in for credit
- Upcoming high-stakes deadlines that need preparation
- Positive trends worth reinforcing

Keep it concise, practical, and parent-friendly. No jargon.`;
}

/** Max HTML length to send to AI (token/size limit). */
const PARSE_HTML_MAX_CHARS = 50_000;

/**
 * System prompt for structured HTML extraction. AI must return only valid JSON matching the schema.
 */
export function getParseHtmlPrompt(schema: string): string {
  return `You are a precise HTML parser. Extract structured data from the provided HTML snippet.

Rules:
- Return ONLY a single JSON object matching this schema. No markdown, no code fences, no explanation.
- Schema: ${schema}
- Preserve field names and types. Use null for missing values. Use [] for empty arrays.
- If the HTML contains a table, map columns to schema fields by header text or position.
- If you cannot extract any data, return an empty object {} or the minimal structure (e.g. { "courses": [] }).`;
}

export function getParseHtmlMaxChars(): number {
  return PARSE_HTML_MAX_CHARS;
}

/**
 * Prompt for batch course title normalization across SIS/LMS sources.
 * AI groups equivalent courses and returns canonical titles.
 */
export function getNormalizeCoursePrompt(
  titles: ReadonlyArray<{ readonly raw: string; readonly provider: string; readonly period?: string }>,
): string {
  const rows = titles.map(t => `  - "${t.raw}" (${t.provider}${t.period ? `, period ${t.period}` : ''})`).join('\n');

  return `You are a course title normalization engine for a K-12 school data system.

Given course titles from different school platforms (SIS like Skyward/Aeries and LMS like Canvas/Google Classroom), group equivalent courses and return a single canonical title for each raw title.

## Input Courses
${rows}

## Rules
1. Match courses that refer to the same class even if titles differ (e.g. "ALGEBRA 1" from Skyward = "algebra" from Canvas = "Algebra 1" from Google Classroom).
2. Use the SIS (Skyward/Aeries) title as the canonical form when available, since it's the official school record.
3. Strip emojis, extra whitespace, and teacher/room info from titles before comparing.
4. Preserve course level numbers (e.g. "1", "2", "AP") in the canonical form.
5. If a Canvas title like "algebra" clearly matches a Skyward title like "ALGEBRA 1", use "ALGEBRA 1" as canonical.
6. Courses in the same period from different sources are likely the same class.
7. Use UPPERCASE for canonical titles to match official school convention.

## Output Format
Return ONLY a JSON object mapping each raw title to its canonical title. No markdown, no code fences, no explanation.

Example:
{
  "ALGEBRA 1": "ALGEBRA 1",
  "algebra": "ALGEBRA 1",
  "BIOLOGY": "BIOLOGY",
  "biology🧬": "BIOLOGY"
}`;
}

# Customize a Scholaracle Scraper

## Instructions for AI

I have an existing Scholaracle scraper that works, but I want to add more data extraction or modify its behavior.

## Current Scraper

- **Platform:** [e.g., Canvas, Aeries, Skyward]
- **What it currently extracts:** [e.g., courses, grades, assignments]
- **What I want to add:** [e.g., "also scrape teacher emails", "add attendance", "extract assignment descriptions"]

## My Current Scraper Code

[Paste the scraper file or describe it]

## What To Add

Here are the entity types that can be extracted. Add any that the platform supports:

- [ ] **studentProfile** — name, studentId, gradeLevel, school
- [ ] **course** — title, code, teacher, period, room, schedule
- [ ] **gradeSnapshot** — grades per course with category breakdowns
- [ ] **assignment** — every assignment with description, rubric, feedback
- [ ] **attendanceEvent** — daily/period attendance records
- [ ] **teacher** — name, email, phone, office hours
- [ ] **courseMaterial** — files, documents, syllabi, study guides
- [ ] **message** — announcements, teacher messages
- [ ] **academicTerm** — semesters, quarters, grading periods
- [ ] **institution** — school name, address

## Rules

1. Add new extraction in the `scrape()` method (navigate to new pages as needed)
2. Add new mappings in the transformer's transform function
3. Don't break existing extraction — only add to it
4. Follow the same patterns already in the scraper (error handling, timeouts, selectors)
5. Every new entity needs a unique `externalId` in the key

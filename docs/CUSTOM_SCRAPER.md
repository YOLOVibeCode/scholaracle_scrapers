# Creating a Custom Scraper

This guide covers two ways to create a scraper for a school portal that isn't already supported.

## Option 1: AI-powered generator (recommended)

```bash
npx scholaracle-scraper generate
```

The wizard:

1. Fetches your students from Scholaracle.
2. Asks for the portal login URL and credentials.
3. Uses AI (OpenAI or Anthropic) to generate a Playwright scraper + transformer.
4. Saves a scraper profile so you can run it with `npx scholaracle-scraper run`.

### Requirements

- An AI API key configured during `setup` (OpenAI or Anthropic).
- The portal login URL (e.g., `https://myschool.powerschool.com`).
- Student portal credentials.

### Output

The generator creates a scraper profile in your local config. Run it with:

```bash
npx scholaracle-scraper run <platform-slug>
```

To write the generated files to disk (for manual editing):

```bash
npx scholaracle-scraper generate --output-dir ./my-scrapers
```

## Option 2: Manual (from template)

### Step 1: Copy the template

```bash
cp -r src/scrapers/_template src/scrapers/my-portal
```

### Step 2: Create three files

Every scraper follows the **three-file pattern**:

```
src/scrapers/my-portal/
├── metadata.json            # Identity + capabilities
├── my-portal-scraper.ts     # Playwright automation (extends BaseScraper)
└── my-portal-transformer.ts # Raw data → ISlcDeltaOp[] (pure function)
```

### Step 3: metadata.json

```json
{
  "id": "my-portal",
  "name": "My Portal",
  "provider": "my-portal",
  "adapterId": "com.example.my-portal",
  "version": "1.0.0",
  "entityTypes": ["course", "assignment", "gradeSnapshot", "studentProfile"]
}
```

### Step 4: Implement the scraper

Extend `BaseScraper` and implement the lifecycle:

```typescript
import { chromium, type Page, type Browser } from 'playwright';
import { BaseScraper } from '../../core/base-scraper';
import type { IScraperConfig, IScraperMetadata, ISlcDeltaOp } from '../../core/types';
import { transformMyPortalExtract } from './my-portal-transformer';
import metadata from './metadata.json';

export class MyPortalScraper extends BaseScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;

  get metadata(): IScraperMetadata { return metadata as IScraperMetadata; }

  async initialize(config: IScraperConfig): Promise<void> {
    this.config = config;
    this.browser = await chromium.launch({ headless: config.options?.headless ?? true });
    this.page = await this.browser.newPage();
  }

  async authenticate(): Promise<{ success: boolean; message?: string }> {
    await this.page!.goto(this.config!.credentials.baseUrl);
    await this.page!.fill('#username', this.config!.credentials.username ?? '');
    await this.page!.fill('#password', this.config!.credentials.password ?? '');
    await this.page!.click('button[type="submit"]');
    await this.page!.waitForLoadState('networkidle');
    return { success: true };
  }

  async scrape(): Promise<Record<string, unknown>> {
    // Navigate pages, extract data, return raw object
    return { courses: [], studentName: 'Emma' };
  }

  transform(rawData: Record<string, unknown>): ISlcDeltaOp[] {
    return transformMyPortalExtract(rawData as any, this.getContext());
  }

  async cleanup(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
  }
}
```

### Step 5: Implement the transformer

The transformer is a **pure function** — no browser, no side effects, easy to test:

```typescript
import type { ISlcDeltaOp, TransformContext } from '../../core/types';

export function transformMyPortalExtract(
  extract: IMyPortalExtract,
  ctx: TransformContext
): ISlcDeltaOp[] {
  const ops: ISlcDeltaOp[] = [];
  const now = new Date().toISOString();
  const baseKey = {
    provider: ctx.provider,
    adapterId: ctx.adapterId,
    studentExternalId: ctx.studentExternalId,
    institutionExternalId: ctx.institutionExternalId,
  };

  // Map courses
  for (const course of extract.courses) {
    ops.push({
      op: 'upsert',
      entity: 'course',
      key: { ...baseKey, externalId: course.id },
      observedAt: now,
      record: { title: course.name },
    });
  }

  return ops;
}
```

### Step 6: Write tests first (TDD)

```typescript
// my-portal-transformer.test.ts
import { transformMyPortalExtract } from './my-portal-transformer';

const ctx = {
  provider: 'my-portal',
  adapterId: 'com.example.my-portal',
  studentExternalId: 'stu-1',
  institutionExternalId: 'inst-1',
};

function makeExtract(overrides?: Partial<IMyPortalExtract>): IMyPortalExtract {
  return { courses: [], studentName: 'Test', ...overrides };
}

describe('transformMyPortalExtract', () => {
  it('should produce course ops', () => {
    const ops = transformMyPortalExtract(
      makeExtract({ courses: [{ id: 'c1', name: 'Math' }] }),
      ctx
    );
    const courseOps = ops.filter(o => o.entity === 'course');
    expect(courseOps).toHaveLength(1);
    expect(courseOps[0].record.title).toBe('Math');
  });

  it('should handle empty courses', () => {
    const ops = transformMyPortalExtract(makeExtract(), ctx);
    expect(ops.filter(o => o.entity === 'course')).toHaveLength(0);
  });
});
```

### Step 7: Run it

```bash
npx scholaracle-scraper run my-portal
```

## Data extraction checklist

When building a scraper, aim to extract as many of these as the portal provides:

- [ ] **Student profile** — name, ID, grade level
- [ ] **Courses** — title, course code, teacher
- [ ] **Assignments** — title, due date, points possible/earned, status, category
- [ ] **Grade snapshots** — current grade per course (letter, percentage, GPA)
- [ ] **Attendance** — date, status (present/absent/tardy), period
- [ ] **Teachers** — name, email
- [ ] **Course materials** — files, links, syllabi (URLs for asset pipeline)
- [ ] **Messages/announcements** — subject, body, sender, date
- [ ] **Academic terms** — semester/quarter names and dates

## Tips

- Use `page.evaluate()` to extract data from the DOM in bulk (faster than many `page.$()` calls).
- Set `waitUntil: 'networkidle'` when navigating to pages that load data via AJAX.
- Use `page.waitForSelector()` before extracting data to handle slow-loading elements.
- Keep the scraper class thin (browser automation only) and put all data mapping in the transformer.
- Test the transformer with realistic data — see `src/scrapers/canvas/canvas-transformer.test.ts` for reference.

## Reference

- Template: `src/scrapers/_template/`
- Canvas scraper: `src/scrapers/canvas/` (full reference implementation)
- Entity types: `src/core/types.ts`
- Base scraper: `src/core/base-scraper.ts`

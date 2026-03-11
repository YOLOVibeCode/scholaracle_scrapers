/**
 * Template Scraper — copy this directory and rename to create a new scraper.
 *
 * Steps:
 * 1. Copy this directory to src/scrapers/{your-platform}/
 * 2. Rename files: template-scraper.ts -> {platform}-scraper.ts, etc.
 * 3. Update metadata.json with your platform details
 * 4. Implement the Playwright scraping logic in scrape()
 * 5. Implement the transform() function to produce ISlcDeltaOp[]
 * 6. Run: npx scholaracle-scraper run {your-platform}
 *
 * See docs/DATA_EXTRACTION_CHECKLIST.md for what to extract.
 * See src/scrapers/canvas/ for a complete reference implementation.
 */

import { chromium, type Page, type Browser } from 'playwright';
import { BaseScraper } from '../../core/base-scraper';
import type { IScraperConfig, IScraperMetadata, ISlcDeltaOp } from '../../core/types';
import metadata from './metadata.json';

// ---------------------------------------------------------------------------
// Raw extract types (define what your scraper produces before transformation)
// ---------------------------------------------------------------------------

interface IRawExtract {
  studentName: string;
  courses: Array<{
    name: string;
    grade?: string;
    teacher?: string;
    assignments: Array<{
      title: string;
      dueDate?: string;
      points?: number;
      score?: number;
      status?: string;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Scraper implementation
// ---------------------------------------------------------------------------

export class TemplateScraper extends BaseScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;

  get metadata(): IScraperMetadata {
    return metadata as IScraperMetadata;
  }

  async initialize(config: IScraperConfig): Promise<void> {
    this.config = config;
    this.browser = await chromium.launch({
      headless: config.options?.headless ?? true,
    });
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(config.options?.timeout ?? 20000);
  }

  async authenticate(): Promise<{ success: boolean; message?: string }> {
    if (!this.page) return { success: false, message: 'Browser not initialized' };

    try {
      const baseUrl = this.config!.credentials.baseUrl;
      await this.page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 20000 });

      // TODO: Implement login for your platform
      // Example:
      // await this.page.fill('#username', this.config!.credentials.username ?? '');
      // await this.page.fill('#password', this.config!.credentials.password ?? '');
      // await this.page.click('button[type="submit"]');
      // await this.page.waitForLoadState('networkidle');

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  }

  async scrape(): Promise<Record<string, unknown>> {
    if (!this.page) throw new Error('Browser not initialized');

    // TODO: Implement scraping logic for your platform
    // Navigate to each page, extract data, return raw extract
    //
    // See docs/DATA_EXTRACTION_CHECKLIST.md for what to extract:
    // - Student profile (name, ID, grade level)
    // - Courses with grades
    // - Assignments with scores, status, descriptions
    // - Attendance records
    // - Teacher information
    // - Course materials/documents
    // - Messages/announcements

    const result: IRawExtract = {
      studentName: 'Student Name',
      courses: [],
    };

    return result as unknown as Record<string, unknown>;
  }

  transform(rawData: Record<string, unknown>): ISlcDeltaOp[] {
    const extract = rawData as unknown as IRawExtract;
    const ops: ISlcDeltaOp[] = [];
    const now = new Date().toISOString();

    const baseKey = {
      provider: this.config!.provider,
      adapterId: this.config!.adapterId,
      studentExternalId: this.config!.studentExternalId,
      institutionExternalId: this.config!.institutionExternalId,
    };

    // Student profile
    ops.push({
      op: 'upsert',
      entity: 'studentProfile',
      key: { ...baseKey, externalId: `profile-${this.config!.studentExternalId}` },
      observedAt: now,
      record: { name: extract.studentName },
    });

    // Courses + assignments
    for (let i = 0; i < extract.courses.length; i++) {
      const course = extract.courses[i]!;
      const courseExtId = `course-${i}`;

      ops.push({
        op: 'upsert',
        entity: 'course',
        key: { ...baseKey, externalId: courseExtId },
        observedAt: now,
        record: {
          title: course.name,
          teacherName: course.teacher,
        },
      });

      for (let j = 0; j < course.assignments.length; j++) {
        const a = course.assignments[j]!;
        ops.push({
          op: 'upsert',
          entity: 'assignment',
          key: { ...baseKey, externalId: `${courseExtId}-assignment-${j}`, courseExternalId: courseExtId },
          observedAt: now,
          record: {
            title: a.title,
            dueAt: a.dueDate,
            pointsPossible: a.points,
            pointsEarned: a.score,
            status: a.status as any,
            courseExternalId: courseExtId,
          },
        });
      }
    }

    return ops;
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
    }
  }
}

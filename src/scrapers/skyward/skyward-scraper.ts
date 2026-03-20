/**
 * Skyward Family Access Browser Scraper
 *
 * Uses Playwright to log into Skyward Family Access (username + password),
 * handle the popup window pattern, and extract:
 *   - Gradebook (courses, grades, missing assignments)
 *   - Attendance
 *   - Schedule
 */

import { chromium, type Page, type Browser, type BrowserContext } from 'playwright';
import { BaseScraper } from '../../core/base-scraper';
import type { ISlcDeltaOp } from '@scholaracle/contracts';
import type { IScraperConfig, IScraperMetadata } from '../../core/scraper-types';
import {
  transformSkywardExtract,
  type ISkywardFullExtract,
  type ISkywardAssignmentExtract,
  type ISkywardCourseExtract,
  type ISkywardMissingAssignment,
  type ISkywardAttendanceExtract,
  type ISkywardScheduleEntry,
} from './skyward-transformer';
import metadata from './metadata.json';
import { useStrategy, computeFingerprint } from '../../core/strategy-store';

const CLASS_DESC_REGEX = /<table\s+id="classDesc_(\d+_\d+_\d+_\d+)"[^>]*>(.*?)<\/table>/gs;

/** Grade period literals in priority order (most recent school term first). */
const GRADE_PERIOD_PRIORITY = ['4TH', 'PR4', '3RD', 'PR3', '2ND', 'PR2', '1ST', 'PR1'];

function parseCoursesFromHtml(html: string, tableRegex: RegExp): ISkywardCourseExtract[] {
  const courses: ISkywardCourseExtract[] = [];
  let match;
  const regex = new RegExp(tableRegex.source, 'gs');
  while ((match = regex.exec(html)) !== null) {
    const sectionId = match[1]; // e.g. "111217_29457_0_02"
    const content = match[2];
    const nameM = content?.match(/class="bld classDesc"><a[^>]*>([^<]+)<\/a>/);
    const periodM = content?.match(/Period<\/label>\s*(\d+[A-Z]?)/);
    const timeM = content?.match(/\((\d+:\d+\s*[AP]M\s*-\s*\d+:\d+\s*[AP]M)\)/);
    const teacherMs = [...(content?.matchAll(/<a[^>]*href="javascript:void\(0\)"[^>]*>([^<]+)<\/a>/g) ?? [])];
    const name = nameM?.[1]?.trim().replace(/&amp;/g, '&') ?? '?';
    const teacher =
      teacherMs.length > 0
        ? [...teacherMs].reverse().find((m) => m[1]!.trim() !== name && m[1]!.trim().length > 2)?.[1]?.trim() ?? ''
        : '';
    // Extract course number ID (cni) from the section ID (e.g. "111217_29457_0_02" → "29457")
    const cniParts = sectionId?.split('_');
    const courseCni = cniParts && cniParts.length >= 2 ? cniParts[1] : undefined;
    courses.push({
      name,
      period: periodM?.[1] ?? '?',
      time: timeM?.[1] ?? '',
      teacher,
      currentGrade: '',
      grades: {},
      _cni: courseCni,
    });
  }
  return courses;
}

export class SkywardScraper extends BaseScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private baseUrl = '';

  get metadata(): IScraperMetadata {
    return metadata as IScraperMetadata;
  }

  async initialize(config: IScraperConfig): Promise<void> {
    this.config = config;
    this.baseUrl = config.credentials.baseUrl.replace(/\/$/, '');
    this.browser = await chromium.launch({
      headless: config.options?.headless ?? true,
    });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(config.options?.timeout ?? 20000);
  }

  async authenticate(): Promise<{ success: boolean; message?: string }> {
    if (!this.page || !this.context) return { success: false, message: 'Browser not initialized' };

    try {
      await this.page.goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 20000 });

      // Select Family/Student Access if dropdown exists
      await this.page.locator('select').selectOption({ label: 'Family/Student Access' }).catch(() => {});

      const hasGoogleLogin = await this.page.locator(
        'input[value="Login with Google"], button:has-text("Login with Google"), a:has-text("Login with Google"), #bGoogleLogin, [onclick*="google"]',
      ).count() > 0;

      const loginMethod = this.config!.credentials.loginMethod ?? (hasGoogleLogin ? 'google_sso' : 'direct');

      if (loginMethod === 'google_sso') {
        return this.authenticateViaGoogle();
      }

      return this.authenticateViaPassword();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  }

  private async authenticateViaPassword(): Promise<{ success: boolean; message?: string }> {
    if (!this.page || !this.context) return { success: false, message: 'Browser not initialized' };

    await this.page.locator('input[name="login"], #login').fill(this.config!.credentials.username ?? '');
    await this.page.locator('input[name="password"], #password').fill(this.config!.credentials.password ?? '');

    let popup: Page | null = null;
    this.context.on('page', (p: Page) => { popup = p; });

    await this.page.locator('#bLogin').click({ timeout: 10000 });
    await this.page.waitForTimeout(5000);

    if (popup !== null) {
      await (popup as Page).waitForLoadState('networkidle', { timeout: 15000 });
      this.page = popup;
    } else {
      await this.page.waitForLoadState('networkidle');
    }

    const finalUrl = this.page.url();
    if (finalUrl.includes('seplog')) {
      return { success: false, message: `Login may have failed. Current URL: ${finalUrl}` };
    }

    return { success: true };
  }

  private async authenticateViaGoogle(): Promise<{ success: boolean; message?: string }> {
    if (!this.page) return { success: false, message: 'Browser not initialized' };

    const googleBtn = this.page.locator(
      'input[value="Login with Google"], button:has-text("Login with Google"), a:has-text("Login with Google"), #bGoogleLogin, [onclick*="google"]',
    ).first();
    await googleBtn.click({ timeout: 10000 });
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    if (this.page.url().includes('accounts.google.com')) {
      await this.page.waitForSelector('input[type="email"], input[name="identifier"]', { timeout: 15000 });
      await this.page.fill('input[type="email"], input[name="identifier"]', this.config!.credentials.username ?? '');
      await this.page.click('button:has-text("Next"), #identifierNext button');

      await this.page.waitForSelector('input[type="password"], input[name="Passwd"]', { timeout: 10000 });
      await this.page.fill('input[type="password"], input[name="Passwd"]', this.config!.credentials.password ?? '');
      await this.page.click('button:has-text("Next"), #passwordNext button');

      await this.page.waitForURL(
        (url) => !url.hostname.includes('accounts.google.com'),
        { timeout: 30000 },
      );
    }

    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const finalUrl = this.page.url();
    if (finalUrl.includes('seplog') || finalUrl.includes('accounts.google.com')) {
      return { success: false, message: `Google SSO login may have failed. Current URL: ${finalUrl}` };
    }

    return { success: true };
  }

  async scrape(): Promise<Record<string, unknown>> {
    if (!this.page) throw new Error('Browser not initialized');

    const studentName = await this.extractStudentName(this.page);
    const schoolName = await this.extractSchoolName(this.page);

    const { courses, assignments, missingAssignments } = await this.extractGradebook(this.page);
    let attendance: ISkywardAttendanceExtract[] = [];
    let schedule: ISkywardScheduleEntry[] = [];

    try {
      attendance = await this.extractAttendance(this.page);
    } catch {
      // continue
    }

    try {
      schedule = await this.extractSchedule(this.page);
    } catch {
      // continue
    }

    const result: ISkywardFullExtract = {
      student: studentName,
      school: schoolName,
      courses,
      missingAssignments,
      assignments,
      attendance,
      schedule,
      timestamp: new Date().toISOString(),
    };

    return result as unknown as Record<string, unknown>;
  }

  transform(rawData: Record<string, unknown>): ISlcDeltaOp[] {
    const extract = rawData as unknown as ISkywardFullExtract;
    return transformSkywardExtract(extract, {
      provider: this.config!.provider,
      adapterId: this.config!.adapterId,
      studentExternalId: this.config!.studentExternalId,
      institutionExternalId: this.config!.institutionExternalId,
    });
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Navigation
  // -------------------------------------------------------------------------

  /** Dismiss all visible Skyward dialogs by clicking close buttons or pressing Escape. */
  private async dismissAllDialogs(page: Page): Promise<void> {
    // Try up to 3 times in case multiple dialogs are stacked
    for (let attempt = 0; attempt < 3; attempt++) {
      const visibleDialog = page.locator('.sf_DialogWrap:visible').first();
      if ((await visibleDialog.count()) === 0) break;
      // Try clicking the close button (small X icon)
      const closeBtn = page.locator('.sf_DialogWrap:visible .sf_DialogClose, .sf_DialogWrap:visible a[title="Close"]').first();
      if ((await closeBtn.count()) > 0) {
        await closeBtn.click({ timeout: 2000 }).catch(() => {});
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(500);
    }
  }

  private async navigateTo(page: Page, linkText: string): Promise<boolean> {
    try {
      const navLink = page.locator(
        `#sf_NavBarWrap a:has-text("${linkText}"), .sf_navBar a:has-text("${linkText}"), nav a:has-text("${linkText}")`,
      ).first();
      if (await navLink.count() > 0) {
        await navLink.click({ timeout: 5000 });
      } else {
        const links = page.locator(`a:visible:has-text("${linkText}")`);
        const count = await links.count();
        for (let i = 0; i < count; i++) {
          const text = await links.nth(i).textContent();
          if (text?.trim() === linkText) {
            await links.nth(i).click({ timeout: 5000 });
            break;
          }
        }
      }
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Extraction
  // -------------------------------------------------------------------------

  private async extractStudentName(page: Page): Promise<string> {
    return page.evaluate(() => {
      const el = document.querySelector('.sf_headerName, [id*="studentName"]');
      if (el) return el.textContent?.trim() ?? '';
      const header = document.querySelector('#sf_HeaderWrap, header, [role="banner"]');
      if (header) {
        const headerText = header.textContent ?? '';
        const nameMatch = headerText.match(/([A-Z][a-z]+\s+[A-Z]\.?\s*[A-Z][a-z]+)/);
        if (nameMatch) return nameMatch[1]!;
      }
      const topNav = document.querySelectorAll('a, span');
      for (const node of topNav) {
        const text = node.textContent?.trim() ?? '';
        if (text.match(/^[A-Z][a-z]+ [A-Z][a-z]+$/) && text.length < 40) return text;
      }
      return 'Unknown';
    });
  }

  private async extractSchoolName(page: Page): Promise<string> {
    return page.evaluate(() => {
      const el = document.querySelector('[id*="schoolName"]');
      if (el) return el.textContent?.trim() ?? '';
      const allText = document.body?.textContent ?? '';
      const schoolMatch = allText.match(/(LAKE DALLAS HIGH SCHOOL|[A-Z ]{10,}(?:HIGH|MIDDLE|ELEMENTARY) SCHOOL)/);
      return schoolMatch?.[1] ?? 'Unknown School';
    });
  }

  private async extractGradebook(page: Page): Promise<{
    courses: ISkywardCourseExtract[];
    assignments: ISkywardAssignmentExtract[];
    missingAssignments: ISkywardMissingAssignment[];
  }> {
    await this.navigateTo(page, 'Gradebook');
    await page.waitForTimeout(3000);

    const html = await page.content();
    const headers = ['PR1', '1ST', 'PR2', '2ND', 'EX1', 'SM1', 'PR3', '3RD', 'PR4', '4TH', 'EX2', 'SM2', 'FIN'];

    let courses: ISkywardCourseExtract[] = [];
    try {
      courses = await useStrategy({
        extractionId: 'skyward:gradebook:courses',
        platform: 'skyward',
        store: this.strategyStore,
        tryCached: async (strategy) => {
          const regexStep = strategy.selectors.find((s) => s.type === 'regex');
          if (!regexStep) return null;
          const regex = new RegExp(regexStep.value, 'gs');
          const result = parseCoursesFromHtml(html, regex);
          return result.length > 0 ? result : null;
        },
        tryNormal: async () => {
          const result = parseCoursesFromHtml(html, CLASS_DESC_REGEX);
          return result.length > 0
            ? { data: result, selectors: [{ type: 'regex' as const, value: CLASS_DESC_REGEX.source }] }
            : null;
        },
        htmlFingerprint: computeFingerprint(html),
      });
    } catch {
      courses = [];
    }

    // Grade data rows
    const gridIdx = html.indexOf('grid_stuGradesGrid');
    if (gridIdx > 0) {
      const gridHtml = html.slice(gridIdx);
      const trRegex = /<tr[^>]*>(.*?)<\/tr>/gs;
      const summaryRows: string[][] = [];
      let trMatch;

      while ((trMatch = trRegex.exec(gridHtml)) !== null) {
        const tdRegex = /<td[^>]*>(.*?)<\/td>/gs;
        const values: string[] = [];
        let tdMatch;
        while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
          const text = tdMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\u00a0/g, '').trim();
          values.push(text);
        }
        if (values.length !== headers.length) continue;

        const filledCount = values.filter((v) => v && v !== 'X').length;
        const hasNum = values.some((v) => /^\d+$/.test(v));
        if (hasNum && filledCount >= 2) {
          summaryRows.push(values);
        }
      }

      for (let i = 0; i < courses.length && i < summaryRows.length; i++) {
        const row = summaryRows[i]!;
        const grades: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
          if (row[j] && row[j] !== 'X') grades[headers[j]!] = row[j]!;
        }
        courses[i]!.grades = grades;
        courses[i]!.currentGrade =
          grades['3RD'] ?? grades['SM1'] ?? grades['2ND'] ?? grades['PR3'] ?? grades['PR1'] ?? '?';
      }
    }

    // Missing assignments
    const missingAssignments: ISkywardMissingAssignment[] = [];
    const showAll = page.locator('a:has-text("Show All"), button:has-text("Show All")').first();
    if (await showAll.count() > 0) {
      await showAll.click();
      await page.waitForTimeout(2000);
    }

    const html2 = await page.content();
    const missingSection = html2.slice(
      html2.indexOf('Missing Assignments'),
      html2.indexOf('Class Grades'),
    );

    const missingRegex =
      /Due:\s*(\d{2}\/\d{2}\/\d{4})\s*<a[^>]*>([^<]+)<\/a>.*?<a[^>]*>([^<]+)<\/a>\s*&nbsp;\s*<span[^>]*>\(Period\s*&nbsp;<b>(\d+[A-Z]?)<\/b>\)\s*<\/span>\s*&nbsp;\s*<a[^>]*>([^<]+)<\/a>/gs;
    let missingMatch;
    while ((missingMatch = missingRegex.exec(missingSection)) !== null) {
      missingAssignments.push({
        dueDate: missingMatch[1]!,
        title: missingMatch[2]!.replace(/&amp;/g, '&').trim(),
        course: missingMatch[3]!.trim(),
        period: missingMatch[4]!,
        teacher: missingMatch[5]!.trim(),
      });
    }

    if (missingAssignments.length === 0) {
      const simpleRegex =
        /showAssignmentInfo[^>]*>([^<]+)<\/a>.*?<a[^>]*>([^<]+)<\/a>\s*(?:&nbsp;)?\s*<span[^>]*>\(Period\s*(?:&nbsp;)?<b>(\d+[A-Z]?)<\/b>/gs;
      let sm;
      while ((sm = simpleRegex.exec(missingSection)) !== null) {
        missingAssignments.push({
          title: sm[1]!.replace(/&amp;/g, '&').trim(),
          course: sm[2]!.trim(),
          period: sm[3]!,
          teacher: '',
          dueDate: '',
        });
      }
    }

    // Dismiss ALL Skyward dialogs — they overlay the gradebook and intercept clicks.
    // Skyward dialogs use .sf_DialogWrap with close buttons having class sf_DialogClose.
    await this.dismissAllDialogs(page);

    const allAssignments: ISkywardAssignmentExtract[] = [];
    for (const course of courses) {
      const courseAssignments = await this.extractAssignmentsForCourse(page, course, html2);
      allAssignments.push(...courseAssignments);
    }

    const withoutDate = allAssignments.filter((a) => !a.dueDate);
    if (withoutDate.length > 0) {
      console.warn(
        `[SkywardScraper] Data quality: ${withoutDate.length}/${allAssignments.length} assignments have no due date`
      );
    }

    return { courses, assignments: allAssignments, missingAssignments };
  }

  /** Parses assignment summary table from gradebook/detail HTML. */
  private parseAssignmentTableFromHtml(
    html: string,
    courseName: string,
    period: string,
  ): ISkywardAssignmentExtract[] {
    const results: ISkywardAssignmentExtract[] = [];
    const tableStart = html.indexOf('id="stuAssignmentSummaryGrid"');
    if (tableStart < 0) return results;

    const tableHtml = html.slice(tableStart);
    const trRegex = /<tr[^>]*>(.*?)<\/tr>/gs;
    let trMatch;
    let isFirst = true;
    while ((trMatch = trRegex.exec(tableHtml)) !== null) {
      if (isFirst) {
        isFirst = false;
        continue;
      }
      const tdRegex = /<td[^>]*>(.*?)<\/td>/gs;
      const cells: string[] = [];
      let tdMatch;
      while ((tdMatch = tdRegex.exec(trMatch[1]!)) !== null) {
        const text = tdMatch[1]!
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\u00a0/g, ' ')
          .trim();
        cells.push(text);
      }
      if (cells.length < 4) continue;
      const title = cells[0]?.trim() ?? '';
      if (!title || title.toLowerCase() === 'assignment') continue;
      const category = cells[1]?.trim() ?? '';
      const dueDate = cells[2]?.trim() ?? '';
      const pointsEarned = cells[3]?.trim() ?? '';
      const pointsPossible = cells.length > 4 ? (cells[4]?.trim() ?? '') : '';
      const grade = cells.length > 5 ? (cells[5]?.trim() ?? '') : pointsEarned;
      const status: 'graded' | 'missing' | 'late' | 'unknown' =
        pointsEarned && /^\d+(\.\d+)?$/.test(pointsEarned) ? 'graded' : 'missing';
      results.push({
        title,
        course: courseName,
        period,
        category,
        dueDate,
        pointsEarned,
        pointsPossible,
        grade,
        status,
      });
    }
    return results;
  }

  /**
   * Extracts assignments for a course by clicking the grade cell in the gradebook grid,
   * which opens a gradeInfoDialog with full assignment details including categories and weights.
   */
  private async extractAssignmentsForCourse(
    page: Page,
    course: ISkywardCourseExtract,
    _currentHtml: string,
  ): Promise<ISkywardAssignmentExtract[]> {
    if (!course._cni) {
      return [];
    }

    try {
      // Dismiss any overlay dialog that might intercept the click
      await this.dismissAllDialogs(page);

      // Find the grade cell for the most current grading period
      let gradeCell = null;
      for (const period of GRADE_PERIOD_PRIORITY) {
        const cell = page.locator(`a#showGradeInfo[data-cni="${course._cni}"][data-lit="${period}"]`).first();
        if ((await cell.count()) > 0) {
          gradeCell = cell;
          break;
        }
      }

      if (!gradeCell) {
        // Fallback: try any grade cell for this course
        gradeCell = page.locator(`a#showGradeInfo[data-cni="${course._cni}"]`).last();
        if ((await gradeCell.count()) === 0) {
          return [];
        }
      }

      await gradeCell.click({ timeout: 5000 });
      await page.waitForTimeout(2000);

      // Parse assignments from the gradeInfoDialog
      const assignments = await page.evaluate(({ courseName, coursePeriod }: { courseName: string; coursePeriod: string }) => {
        const dialog = document.querySelector('#gradeInfoDialog');
        if (!dialog) return [];

        const results: Array<{
          title: string; course: string; period: string; category: string;
          dueDate: string; pointsEarned: string; pointsPossible: string;
          grade: string; status: 'graded' | 'missing' | 'late' | 'unknown';
        }> = [];

        // Find the assignment table (has "Due" and "Assignment" columns)
        const tables = dialog.querySelectorAll('table');
        let assignTable: Element | null = null;
        for (const t of tables) {
          const headerRow = t.querySelector('tr');
          const headerText = headerRow?.textContent ?? '';
          if (headerText.includes('Assignment') && (headerText.includes('Due') || headerText.includes('Score'))) {
            assignTable = t;
            break;
          }
        }

        if (!assignTable) return results;

        let currentCategory = '';
        let currentWeight = '';

        const rows = assignTable.querySelectorAll('tr');
        for (const row of rows) {
          const text = row.textContent?.trim().replace(/\s+/g, ' ') ?? '';

          // Category header row: "Major weighted at 40.00% 85 85.47 ..."
          if (text.includes('weighted at')) {
            const catMatch = text.match(/^(\S+)\s*weighted at\s*([\d.]+)%/);
            if (catMatch) {
              currentCategory = catMatch[1]!;
              currentWeight = catMatch[2]!;
            }
            continue;
          }

          // Assignment row — cells: Due, Assignment, Grade, Score(%), Points Earned, Missing, NoCount, Absent
          const cells = row.querySelectorAll('td');
          if (cells.length >= 5) {
            const due = cells[0]?.textContent?.trim() ?? '';
            const title = cells[1]?.textContent?.trim() ?? '';
            const grade = cells[2]?.textContent?.trim() ?? '';
            const pointsRaw = cells[4]?.textContent?.trim() ?? '';
            const missingCell = cells[5]?.textContent?.trim() ?? '';
            const hasMissingImg = cells[5]?.querySelector('img') !== null;

            if (!title || title === 'Assignment' || title.includes('weighted at')) continue;

            // Parse "142 out of 200" → pointsEarned="142", pointsPossible="200"
            const ptsMatch = pointsRaw.match(/([\d.]+)\s*out of\s*([\d.]+)/);
            const pointsEarned = ptsMatch ? ptsMatch[1]! : '';
            const pointsPossible = ptsMatch ? ptsMatch[2]! : '';

            const isMissing = missingCell === 'M' || hasMissingImg;
            const status: 'graded' | 'missing' | 'late' | 'unknown' =
              isMissing ? 'missing' : (grade && /^\d/.test(grade) ? 'graded' : 'unknown');

            results.push({
              title,
              course: courseName,
              period: coursePeriod,
              category: currentCategory,
              dueDate: due,
              pointsEarned,
              pointsPossible,
              grade,
              status,
            });
          }
        }

        return results;
      }, { courseName: course.name, coursePeriod: course.period });

      // Close the gradeInfoDialog
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      return assignments;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SkywardScraper] Failed to extract assignments for ${course.name}: ${msg}`);
      return [];
    }
  }

  private async extractAttendance(page: Page): Promise<ISkywardAttendanceExtract[]> {
    await this.navigateTo(page, 'Attendance');
    await page.waitForTimeout(3000);

    return page.evaluate(() => {
      const results: Array<{ date: string; period: string; status: string; course: string; reason: string }> = [];
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const headerText = table.querySelector('tr')?.textContent ?? '';
        if (!headerText.includes('Attendance') || !headerText.includes('Period')) continue;

        const trs = table.querySelectorAll('tr');
        for (let i = 1; i < trs.length; i++) {
          const tds = trs[i]!.querySelectorAll('td');
          if (tds.length >= 3) {
            const texts = Array.from(tds).map((td) => td.textContent?.trim() ?? '');
            const dateText = texts[0] ?? '';
            if (dateText && /[A-Z][a-z]{2}\s/.test(dateText)) {
              results.push({
                date: dateText,
                status: texts[1] ?? '',
                period: texts[2] ?? '',
                course: texts[3] ?? '',
                reason: '',
              });
            }
          }
        }
      }
      return results;
    });
  }

  private async extractSchedule(page: Page): Promise<ISkywardScheduleEntry[]> {
    await this.navigateTo(page, 'Schedule');
    await page.waitForTimeout(3000);

    return page.evaluate(() => {
      const results: Array<{ period: string; time: string; course: string; teacher: string; room: string }> = [];
      const tables = document.querySelectorAll('table');

      for (const table of tables) {
        const headerRow = table.querySelector('tr');
        const headerText = headerRow?.textContent ?? '';
        if (!headerText.includes('Term') && !headerText.includes('2025')) continue;

        const rows = table.querySelectorAll('tr');
        for (let i = 1; i < rows.length; i++) {
          const tds = rows[i]!.querySelectorAll('td, th');
          if (tds.length < 2) continue;

          const periodCell = tds[0]?.textContent?.trim() ?? '';
          const periodMatch = periodCell.match(/Period\s*(\d+[A-Z]?)/);
          const timeMatch = periodCell.match(/\(([^)]+)\)/);
          if (!periodMatch) continue;

          let bestCell = tds[tds.length - 2];
          for (let j = 1; j < tds.length; j++) {
            const style = tds[j]?.getAttribute('style') ?? '';
            const cls = tds[j]?.getAttribute('class') ?? '';
            if (style.includes('background') || cls.includes('highlight') || cls.includes('cur')) {
              bestCell = tds[j];
              break;
            }
          }

          const cellText = bestCell?.textContent?.trim() ?? '';
          if (!cellText) continue;

          const lines = cellText.split('\n').map((l) => l.trim()).filter((l) => l);
          const course = lines[0] ?? '';
          const teacher = lines[1] ?? '';
          const roomMatch = cellText.match(/Room\s*(\w+)/);
          const room = roomMatch?.[1] ?? '';

          results.push({
            period: periodMatch[1] ?? '',
            time: timeMatch?.[1] ?? '',
            course,
            teacher,
            room,
          });
        }
      }
      return results;
    });
  }
}

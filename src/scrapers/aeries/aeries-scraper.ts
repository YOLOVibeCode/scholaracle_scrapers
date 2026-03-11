/**
 * Aeries Parent Portal Browser Scraper
 *
 * Uses Playwright to log into the Aeries Parent Portal (email + password)
 * and extract student data: courses, grades, assignments, attendance.
 */

import { chromium, type Page, type Browser } from 'playwright';
import { BaseScraper } from '../../core/base-scraper';
import type { IScraperConfig, IScraperMetadata, ISlcDeltaOp } from '../../core/types';
import {
  transformAeriesExtract,
  type IAeriesFullExtract,
  type IAeriesStudentExtract,
  type IAeriesCourseExtract,
  type IAeriesAssignmentExtract,
  type IAeriesAttendanceExtract,
} from './aeries-transformer';
import metadata from './metadata.json';
import { useStrategy, computeFingerprint } from '../../core/strategy-store';

export class AeriesScraper extends BaseScraper {
  private browser: Browser | null = null;
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
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    });
    this.page = await context.newPage();
    this.page.setDefaultTimeout(config.options?.timeout ?? 20000);
  }

  async authenticate(): Promise<{ success: boolean; message?: string }> {
    if (!this.page) return { success: false, message: 'Browser not initialized' };

    try {
      await this.page.goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 30000 });

      const email = this.config!.credentials.username ?? '';
      const password = this.config!.credentials.password ?? '';

      // Step 1: Enter email and click Next
      const emailInput = this.page.locator(
        'input[placeholder="Email"], input[name*="Email"], #EmailAddress',
      );
      await emailInput.fill(email);

      const nextBtn = this.page.locator('button:has-text("Next"), input[value="Next"]');
      await nextBtn.click({ timeout: 10000 });

      await this.page.waitForTimeout(2000);

      // Step 2: Enter password and click Sign In
      const passwordInput = this.page.locator(
        'input[placeholder="Password"], input[type="password"]',
      );
      await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
      await passwordInput.fill(password);

      const signInBtn = this.page.locator('button:has-text("Sign In"), input[value="Sign In"]');
      await signInBtn.click({ timeout: 10000 });

      await this.page.waitForURL('**/Dashboard.aspx', { timeout: 20000 }).catch(() => {});
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await this.page.waitForTimeout(2000);

      const finalUrl = this.page.url();
      if (finalUrl.includes('/login') || finalUrl.includes('LoginParent')) {
        return { success: false, message: `Login may have failed. Current URL: ${finalUrl}` };
      }

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  }

  async scrape(): Promise<Record<string, unknown>> {
    if (!this.page) throw new Error('Browser not initialized');

    const { students: studentList, courses: dashboardCourses } =
      await this.extractDashboard(this.page);

    const gradebookData = await this.extractGradebookDetails(this.page);
    const studentInfo = await this.extractStudentInfo(this.page);

    const enrichedCourses = dashboardCourses.map((c) => {
      const detail = gradebookData.get(c.name) ?? gradebookData.get(c.name.replace(/\s+b$/, ''));
      let bestMatch: { teacherEmail: string; assignments: IAeriesAssignmentExtract[] } | undefined;
      if (!detail) {
        for (const [key, value] of gradebookData.entries()) {
          if (
            key.includes(c.name.split(' ').slice(0, 2).join(' ')) ||
            c.name.includes(key.split(' ').slice(0, 2).join(' '))
          ) {
            bestMatch = value;
            break;
          }
        }
      }
      const matched = detail ?? bestMatch;
      return {
        ...c,
        teacherEmail: matched?.teacherEmail ?? c.teacherEmail,
        assignments: matched?.assignments ?? [],
      };
    });

    let attendance: IAeriesAttendanceExtract[] = [];
    try {
      attendance = await this.extractAttendance(this.page);
    } catch {
      /* skip */
    }

    const allStudents: IAeriesStudentExtract[] = [
      {
        name: (studentInfo.name || studentList[0]?.name) ?? 'Unknown',
        studentId: studentInfo.studentId,
        grade: (studentInfo.grade || studentList[0]?.grade) ?? '',
        school: (studentInfo.school || studentList[0]?.school) ?? '',
        courses: enrichedCourses,
        attendance,
      },
    ];

    // Multi-student: try to scrape additional students
    if (studentList.length > 1) {
      for (let i = 1; i < studentList.length; i++) {
        const studentName = studentList[i]!.name;
        await this.page.goto(
          this.page.url().replace(/\/student\/.*/, '/student/Dashboard.aspx'),
          { waitUntil: 'networkidle', timeout: 15000 },
        );
        await this.page.waitForTimeout(2000);

        if (await this.switchToStudentInUI(this.page, studentName)) {
          const { courses: nextCourses } = await this.extractDashboard(this.page);
          const nextGradebook = await this.extractGradebookDetails(this.page);
          const nextStudentInfo = await this.extractStudentInfo(this.page);
          let nextAttendance: IAeriesAttendanceExtract[] = [];
          try {
            nextAttendance = await this.extractAttendance(this.page);
          } catch {
            /* skip */
          }

          const nextEnrichedCourses = nextCourses.map((c) => {
            const detail = nextGradebook.get(c.name);
            return {
              ...c,
              teacherEmail: detail?.teacherEmail ?? c.teacherEmail,
              assignments: detail?.assignments ?? [],
            };
          });

          allStudents.push({
            name: nextStudentInfo.name || studentName,
            studentId: nextStudentInfo.studentId,
            grade: (nextStudentInfo.grade || studentList[i]?.grade) ?? '',
            school: (nextStudentInfo.school || studentList[i]?.school) ?? '',
            courses: nextEnrichedCourses,
            attendance: nextAttendance,
          });
        }
      }
    }

    const result: IAeriesFullExtract = {
      students: allStudents,
      timestamp: new Date().toISOString(),
    };

    return result as unknown as Record<string, unknown>;
  }

  transform(rawData: Record<string, unknown>): ISlcDeltaOp[] {
    const extract = rawData as unknown as IAeriesFullExtract;
    let filtered = extract;
    if (this.config?.studentName && extract.students.length > 1) {
      const matched = extract.students.filter((s) =>
        s.name.toLowerCase().includes(this.config!.studentName.toLowerCase()),
      );
      filtered = {
        ...extract,
        students: matched.length > 0 ? matched : [extract.students[0]!],
      };
    }
    return transformAeriesExtract(filtered, {
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
      this.page = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Dashboard extraction
  // -------------------------------------------------------------------------

  private async extractDashboard(page: Page): Promise<{
    students: Array<{ name: string; grade: string; school: string }>;
    courses: IAeriesCourseExtract[];
  }> {
    if (!page.url().includes('Dashboard.aspx')) {
      await page.goto(page.url().replace(/\/student\/.*/, '/student/Dashboard.aspx'), {
        waitUntil: 'networkidle',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);
    }

    const students = await page.evaluate(() => {
      const results: Array<{ name: string; grade: string; school: string }> = [];
      const studentEls = document.querySelectorAll(
        '[class*="student-card"], [class*="StudentCard"]',
      );
      if (studentEls.length > 0) {
        for (const el of studentEls) {
          const name =
            el.querySelector('a[href*="Vega"], a[class*="name"], h3, h4, strong')?.textContent?.trim() ??
            '';
          const text = el.textContent ?? '';
          const gradeMatch = text.match(/Grade:\s*(\d+)/);
          const schoolMatch = text.match(/(?:Grade:\s*\d+\s*)(.*?)$/m);
          results.push({
            name: (name || text.split('\n').filter((l) => l.trim())[0]?.trim()) ?? '',
            grade: gradeMatch?.[1] ?? '',
            school: schoolMatch?.[1]?.trim() ?? '',
          });
        }
      }
      if (results.length === 0) {
        const allText = document.body.textContent ?? '';
        const nameMatch = allText.match(/Welcome to the Aeries Portal for\s+(.+)/);
        if (nameMatch) {
          results.push({ name: nameMatch[1]!.trim(), grade: '', school: '' });
        }
      }
      return results;
    });

    const courseRowSelector =
      'tr[class*="class"], tr[data-*], .ClassSummary tr, table tbody tr';
    let courses: IAeriesCourseExtract[];
    try {
      courses = await useStrategy({
        extractionId: 'aeries:dashboard:courses',
        platform: 'aeries',
        store: this.strategyStore,
        tryCached: async (strategy) => {
          const sel = strategy.selectors.find((s) => s.type === 'css');
          if (!sel) return null;
          const results = await page.evaluate(
            (rowSel: string): IAeriesCourseExtract[] => {
              const rows = document.querySelectorAll(rowSel);
              const out: IAeriesCourseExtract[] = [];
              for (const row of rows) {
                const cells = row.querySelectorAll('td, [role="gridcell"]');
                if (cells.length < 3) continue;
                const periodText = cells[0]?.textContent?.trim() ?? '';
                const courseText = cells[1]?.textContent ?? '';
                const gradeText = cells[2]?.textContent?.trim() ?? '';
                const missingText = cells[3]?.textContent?.trim() ?? '';
                if (!periodText || !/^\d+$/.test(periodText)) continue;
                const teacherMatch = courseText.match(/Teacher:\s*([^R\n]+?)(?:\s*Room:|$)/);
                const roomMatch = courseText.match(/Room:\s*(\S+)/);
                const nameMatch = courseText.match(/^([^T]+?)(?:\s*Teacher:|$)/);
                const termMatch = courseText.match(/- (Quarter \d+|Semester \d+|[^-]+)$/m);
                const gradeNumMatch = gradeText.match(/(\d+)\s*\((\d+\.?\d*)%\)/);
                out.push({
                  period: periodText,
                  name:
                    nameMatch?.[1]?.trim().split('\n')[0]?.trim() ??
                    courseText.split('\n')[0]?.trim() ??
                    '',
                  term: termMatch?.[1]?.trim() ?? '',
                  teacher: teacherMatch?.[1]?.trim() ?? '',
                  teacherEmail: '',
                  room: roomMatch?.[1]?.trim() ?? '',
                  currentGrade: gradeNumMatch ? parseInt(gradeNumMatch[1]!, 10) : null,
                  currentPercent: gradeNumMatch ? parseFloat(gradeNumMatch[2]!) : null,
                  missingCount: parseInt(missingText, 10) || 0,
                  assignments: [],
                });
              }
              return out;
            },
            sel.value,
          );
          return results.length > 0 ? results : null;
        },
        tryNormal: async () => {
          const results = await page.evaluate(
            (rowSel: string): IAeriesCourseExtract[] => {
              const rows = document.querySelectorAll(rowSel);
              const out: IAeriesCourseExtract[] = [];
              for (const row of rows) {
                const cells = row.querySelectorAll('td, [role="gridcell"]');
                if (cells.length < 3) continue;
                const periodText = cells[0]?.textContent?.trim() ?? '';
                const courseText = cells[1]?.textContent ?? '';
                const gradeText = cells[2]?.textContent?.trim() ?? '';
                const missingText = cells[3]?.textContent?.trim() ?? '';
                if (!periodText || !/^\d+$/.test(periodText)) continue;
                const teacherMatch = courseText.match(/Teacher:\s*([^R\n]+?)(?:\s*Room:|$)/);
                const roomMatch = courseText.match(/Room:\s*(\S+)/);
                const nameMatch = courseText.match(/^([^T]+?)(?:\s*Teacher:|$)/);
                const termMatch = courseText.match(/- (Quarter \d+|Semester \d+|[^-]+)$/m);
                const gradeNumMatch = gradeText.match(/(\d+)\s*\((\d+\.?\d*)%\)/);
                out.push({
                  period: periodText,
                  name:
                    nameMatch?.[1]?.trim().split('\n')[0]?.trim() ??
                    courseText.split('\n')[0]?.trim() ??
                    '',
                  term: termMatch?.[1]?.trim() ?? '',
                  teacher: teacherMatch?.[1]?.trim() ?? '',
                  teacherEmail: '',
                  room: roomMatch?.[1]?.trim() ?? '',
                  currentGrade: gradeNumMatch ? parseInt(gradeNumMatch[1]!, 10) : null,
                  currentPercent: gradeNumMatch ? parseFloat(gradeNumMatch[2]!) : null,
                  missingCount: parseInt(missingText, 10) || 0,
                  assignments: [],
                });
              }
              return out;
            },
            courseRowSelector,
          );
          return results.length > 0
            ? {
                data: results,
                selectors: [{ type: 'css' as const, value: courseRowSelector }],
              }
            : null;
        },
        htmlFingerprint: computeFingerprint(await page.content()),
      });
    } catch {
      courses = await page.evaluate(
        (rowSel: string): IAeriesCourseExtract[] => {
          const rows = document.querySelectorAll(rowSel);
          const out: IAeriesCourseExtract[] = [];
          for (const row of rows) {
            const cells = row.querySelectorAll('td, [role="gridcell"]');
            if (cells.length < 3) continue;
            const periodText = cells[0]?.textContent?.trim() ?? '';
            const courseText = cells[1]?.textContent ?? '';
            const gradeText = cells[2]?.textContent?.trim() ?? '';
            const missingText = cells[3]?.textContent?.trim() ?? '';
            if (!periodText || !/^\d+$/.test(periodText)) continue;
            const teacherMatch = courseText.match(/Teacher:\s*([^R\n]+?)(?:\s*Room:|$)/);
            const roomMatch = courseText.match(/Room:\s*(\S+)/);
            const nameMatch = courseText.match(/^([^T]+?)(?:\s*Teacher:|$)/);
            const termMatch = courseText.match(/- (Quarter \d+|Semester \d+|[^-]+)$/m);
            const gradeNumMatch = gradeText.match(/(\d+)\s*\((\d+\.?\d*)%\)/);
            out.push({
              period: periodText,
              name:
                nameMatch?.[1]?.trim().split('\n')[0]?.trim() ??
                courseText.split('\n')[0]?.trim() ??
                '',
              term: termMatch?.[1]?.trim() ?? '',
              teacher: teacherMatch?.[1]?.trim() ?? '',
              teacherEmail: '',
              room: roomMatch?.[1]?.trim() ?? '',
              currentGrade: gradeNumMatch ? parseInt(gradeNumMatch[1]!, 10) : null,
              currentPercent: gradeNumMatch ? parseFloat(gradeNumMatch[2]!) : null,
              missingCount: parseInt(missingText, 10) || 0,
              assignments: [],
            });
          }
          return out;
        },
        courseRowSelector,
      );
    }

    return { students, courses };
  }

  // -------------------------------------------------------------------------
  // Private: Gradebook details extraction
  // -------------------------------------------------------------------------

  private async extractGradebookDetails(
    page: Page,
  ): Promise<Map<string, { teacherEmail: string; assignments: IAeriesAssignmentExtract[] }>> {
    const baseUrl = page.url().replace(/\/student\/.*/, '/student/GradebookDetails.aspx');
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);

    const results = new Map<string, { teacherEmail: string; assignments: IAeriesAssignmentExtract[] }>();

    const courseOptions = await page.evaluate(() => {
      const select = document.querySelector(
        'select[id*="DropDown"], select',
      ) as HTMLSelectElement | null;
      if (!select) return [];
      return Array.from(select.options).map((o) => ({
        value: o.value,
        text: o.text.trim(),
      }));
    });

    for (const opt of courseOptions) {
      if (opt.text.startsWith('<<')) continue;

      const dropdown = page.locator('select').first();
      await dropdown.selectOption(opt.value);
      await page.waitForTimeout(2000);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const teacherEmail = await page.evaluate(() => {
        const emailLink = document.querySelector(
          'a[href*="@"][href*="mailto"], a[href*="@"]',
        );
        if (emailLink) return emailLink.textContent?.trim() ?? '';
        const text = document.body.textContent ?? '';
        const match = text.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
        return match?.[0] ?? '';
      });

      const assignments = await page.evaluate(() => {
        const results: IAeriesAssignmentExtract[] = [];
        const body = document.body.innerHTML;
        const assignmentBlocks = body.split(/(?=<div[^>]*class="[^"]*[Aa]ssignment)/);

        for (const block of assignmentBlocks) {
          const titleMatch = block.match(/<[^>]*class="[^"]*[Tt]itle[^"]*"[^>]*>([^<]+)/);
          if (!titleMatch) continue;

          const scoreMatch = block.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
          const percentMatch = block.match(/(\d+(?:\.\d+)?)%/);
          const dueDateMatch = block.match(/Due\s*(?:Date)?:?\s*(\d{2}\/\d{2}\/\d{4})/);
          const assignedMatch = block.match(/(?:Date\s*)?Assigned:?\s*(\d{2}\/\d{2}\/\d{4})/);
          const completedMatch = block.match(/(?:Date\s*)?Completed:?\s*(\d{2}\/\d{2}\/\d{4})/);
          const categoryMatch = block.match(/(?:Formative|Summative)/i);
          const gradingMatch = block.match(/Grading\s*Complete:?\s*(True|False)/i);
          const missingMatch = block.match(/(?:Missing|MSG)/i);

          results.push({
            number: '',
            title: titleMatch[1]!.trim(),
            category: categoryMatch?.[0] ?? '',
            scoreEarned: scoreMatch ? parseFloat(scoreMatch[1]!) : null,
            scorePossible: scoreMatch ? parseFloat(scoreMatch[2]!) : null,
            percentCorrect: percentMatch ? parseFloat(percentMatch[1]!) : null,
            dateAssigned: assignedMatch?.[1] ?? '',
            dateDue: dueDateMatch?.[1] ?? '',
            dateCompleted: completedMatch?.[1] ?? '',
            gradingComplete: gradingMatch?.[1]?.toLowerCase() === 'true',
            isMissing: !!missingMatch,
            comment: '',
          });
        }

        if (results.length === 0) {
          const allText = document.body.innerText;
          const parts = allText.split(/(?=\n\d+\s*-\s+[^\n]+)/);
          for (const part of parts) {
            const headerMatch = part.match(/^(\d+)\s*-\s+(.+)/);
            if (!headerMatch) continue;

            const number = headerMatch[1]!;
            const title = headerMatch[2]!.split('\n')[0]!.trim();
            const categoryMatch = part.match(/(Formative|Summative)/i);
            const scoreMatch = part.match(/Score\s*\n?\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
            const percentMatch = part.match(/(\d+(?:\.\d+)?)%/);
            const dueDateMatch = part.match(/Due\s*Date:?\s*(\d{2}\/\d{2}\/\d{4})/);
            const assignedMatch = part.match(/Date\s*Assigned:?\s*(\d{2}\/\d{2}\/\d{4})/);
            const completedMatch = part.match(/Date\s*Completed:?\s*(\d{2}\/\d{2}\/\d{4})/);
            const gradingMatch = part.match(/Grading\s*Complete:?\s*(True|False)/i);
            const missingClass = part.match(/Missing|MSG -|EXC -/i);

            results.push({
              number,
              title,
              category: categoryMatch?.[1] ?? '',
              scoreEarned: scoreMatch ? parseFloat(scoreMatch[1]!) : null,
              scorePossible: scoreMatch ? parseFloat(scoreMatch[2]!) : null,
              percentCorrect: percentMatch ? parseFloat(percentMatch[1]!) : null,
              dateAssigned: assignedMatch?.[1] ?? '',
              dateDue: dueDateMatch?.[1] ?? '',
              dateCompleted: completedMatch?.[1] ?? '',
              gradingComplete: gradingMatch?.[1]?.toLowerCase() === 'true',
              isMissing: !!missingClass,
              comment: '',
            });
          }
        }

        return results;
      });

      const courseNameMatch = opt.text.match(
        /^\d+-\s*(.+?)-\s*(Quarter \d+|Semester \d+|[^1-9]+)\s/,
      );
      const courseName = courseNameMatch?.[1]?.trim() ?? opt.text;

      results.set(courseName, { teacherEmail, assignments });
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Private: Attendance extraction
  // -------------------------------------------------------------------------

  private async extractAttendance(page: Page): Promise<IAeriesAttendanceExtract[]> {
    const baseUrl = page.url().replace(/\/student\/.*/, '/student/Attendance.aspx');
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);

    return page.evaluate(() => {
      const results: IAeriesAttendanceExtract[] = [];
      const rows = document.querySelectorAll('table tr, [class*="attendance"] tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue;

        const texts = Array.from(cells).map((td) => td.textContent?.trim() ?? '');
        const dateText = texts[0] ?? '';
        if (dateText && /\d{1,2}\/\d{1,2}\/\d{4}/.test(dateText)) {
          results.push({
            date: dateText,
            period: texts[1] ?? '',
            status: texts[2] ?? '',
            reason: texts[3] ?? '',
            course: texts[4] ?? '',
          });
        }
      }
      if (results.length === 0) {
        const text = document.body.innerText;
        const lines = text.split('\n');
        for (const line of lines) {
          const match = line.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(.+)/);
          if (match) {
            results.push({
              date: match[1]!,
              period: '',
              status: match[2]?.trim() ?? '',
              reason: '',
              course: '',
            });
          }
        }
      }
      return results;
    });
  }

  // -------------------------------------------------------------------------
  // Private: Student info extraction
  // -------------------------------------------------------------------------

  private async extractStudentInfo(page: Page): Promise<{
    studentId: string;
    name: string;
    grade: string;
    school: string;
  }> {
    return page.evaluate(() => {
      const text = document.body.innerText;
      const idMatch = text.match(/ID:\s*(\d+)/);
      const gradeMatch = text.match(/Grade:\s*(\d+)/);

      const nameEl = document.querySelector(
        '[class*="student-name"], h2, [class*="Header"] a',
      );
      let name = nameEl?.textContent?.trim() ?? '';
      if (!name) {
        const headerMatch = text.match(
          /(?:Welcome to the Aeries Portal for|Gradebook Details\s+)([A-Z][a-z]+ [A-Z][a-z]+)/,
        );
        name = headerMatch?.[1] ?? '';
      }

      const schoolMatch = text.match(/([\w\s]+(?:High School|Middle School|Elementary))/);

      return {
        studentId: idMatch?.[1] ?? '',
        name,
        grade: gradeMatch?.[1] ?? '',
        school: schoolMatch?.[1]?.trim() ?? '',
      };
    });
  }

  // -------------------------------------------------------------------------
  // Private: Student switcher (multi-student accounts)
  // -------------------------------------------------------------------------

  private async switchToStudentInUI(page: Page, studentName: string): Promise<boolean> {
    try {
      const dropdown = page.locator('[class*="student-selector"], [class*="StudentDrop"]').first();
      if ((await dropdown.count()) > 0) {
        await dropdown.click();
        await page.waitForTimeout(1000);
      }

      const studentLink = page.locator(`a:has-text("${studentName}")`).first();
      if ((await studentLink.count()) > 0) {
        await studentLink.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(2000);
        return true;
      }
    } catch {
      /* skip */
    }
    return false;
  }
}

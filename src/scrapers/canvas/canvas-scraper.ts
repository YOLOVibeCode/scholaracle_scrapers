/**
 * Canvas LMS Browser Scraper
 *
 * Uses Playwright to log into Canvas (supports Google SSO and direct login)
 * and extract student data from the dashboard and course pages.
 */

import { chromium, type Page, type Browser } from 'playwright';
import { BaseScraper } from '../../core/base-scraper';
import type { ISlcDeltaOp } from '@scholaracle/contracts';
import type { IScraperConfig, IScraperMetadata } from '../../core/scraper-types';
import {
  transformCanvasExtract,
  type ICanvasBrowserExtract,
  type ICanvasBrowserCourse,
  type ICanvasBrowserTeacher,
  type ICanvasBrowserAssignment,
  type ICanvasBrowserModule,
  type ICanvasBrowserFile,
  type ICanvasBrowserToDoItem,
  type ICanvasBrowserEvent,
  type ICanvasBrowserAnnouncement,
} from './canvas-transformer';
import metadata from './metadata.json';
import { useStrategy, computeFingerprint } from '../../core/strategy-store';

export class CanvasScraper extends BaseScraper {
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
    const context = await this.browser.newContext();
    this.page = await context.newPage();
    this.page.setDefaultTimeout(config.options?.timeout ?? 20000);
  }

  async authenticate(): Promise<{ success: boolean; message?: string }> {
    if (!this.page) return { success: false, message: 'Browser not initialized' };

    try {
      await this.page.goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 20000 });

      const currentUrl = this.page.url();
      const loginMethod = this.config!.credentials.loginMethod ?? 'direct';

      if (currentUrl.includes('accounts.google.com') || loginMethod === 'google_sso') {
        if (!currentUrl.includes('accounts.google.com')) {
          const googleLink = this.page.locator(
            'a:has-text("Google"), a[href*="google"], button:has-text("Google"), [class*="google"]',
          ).first();
          if (await googleLink.count() > 0) {
            await googleLink.click();
            await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          }
        }

        if (this.page.url().includes('accounts.google.com')) {
          await this.loginViaGoogle(
            this.page,
            this.config!.credentials.username ?? '',
            this.config!.credentials.password ?? '',
          );
        }
      } else {
        const emailInput = this.page.locator('input[type="email"], input[name="pseudonym_session[unique_id]"], #pseudonym_session_unique_id');
        const passInput = this.page.locator('input[type="password"], input[name="pseudonym_session[password]"], #pseudonym_session_password');

        if (await emailInput.count() > 0) {
          await emailInput.fill(this.config!.credentials.username ?? '');
          await passInput.fill(this.config!.credentials.password ?? '');
          await this.page.locator('input[type="submit"][value="Log In"], button[type="submit"]:has-text("Log In")').first().click();
          await this.page.waitForLoadState('networkidle');
        }
      }

      await this.page.waitForLoadState('networkidle');

      const finalUrl = this.page.url();
      if (finalUrl.includes('accounts.google.com') || finalUrl.includes('/login')) {
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

    const dashboard = await this.extractDashboard(this.page);
    let courses = await this.extractCoursesViaApi(this.page);

    for (let i = 0; i < courses.length; i++) {
      courses[i] = await this.extractCourseDetail(this.page, courses[i]!);
    }

    const announcements = await this.extractAnnouncementsViaApi(
      this.page,
      courses.map(c => c.id),
    );

    const result: ICanvasBrowserExtract = {
      user: dashboard.user,
      courses,
      toDoItems: dashboard.toDoItems,
      upcomingEvents: dashboard.upcomingEvents,
      announcements,
      timestamp: new Date().toISOString(),
    };

    return result as unknown as Record<string, unknown>;
  }

  transform(rawData: Record<string, unknown>): ISlcDeltaOp[] {
    const extract = rawData as unknown as ICanvasBrowserExtract;
    return transformCanvasExtract(extract, {
      provider: this.config!.provider,
      adapterId: this.config!.adapterId,
      studentExternalId: this.config!.studentExternalId,
      institutionExternalId: this.config!.institutionExternalId,
    });
  }

  async getRequestHeaders(): Promise<Record<string, string>> {
    if (!this.page) return {};
    try {
      const context = this.page.context();
      const cookies = await context.cookies();
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      return cookieHeader ? { Cookie: cookieHeader } : {};
    } catch {
      return {};
    }
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Google SSO login
  // -------------------------------------------------------------------------

  private async loginViaGoogle(page: Page, email: string, password: string): Promise<void> {
    await page.waitForSelector('input[type="email"], input[name="identifier"]', { timeout: 15000 });
    await page.fill('input[type="email"], input[name="identifier"]', email);
    await page.click('button:has-text("Next"), #identifierNext button');

    await page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 10000 });
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button:has-text("Next"), #passwordNext button');

    await page.waitForURL((url) => !url.hostname.includes('accounts.google.com'), { timeout: 30000 });
  }

  // -------------------------------------------------------------------------
  // Private: Dashboard extraction
  // -------------------------------------------------------------------------

  private readonly DASHBOARD_USER_SELECTOR =
    '#global_nav_profile_link, [data-testid="global_nav_profile_link"]';

  private async extractDashboard(page: Page): Promise<{
    user: string;
    toDoItems: ICanvasBrowserToDoItem[];
    upcomingEvents: ICanvasBrowserEvent[];
  }> {
    let user: string;
    try {
      user = await useStrategy({
        extractionId: 'canvas:dashboard:user',
        platform: 'canvas',
        store: this.strategyStore,
        tryCached: async (strategy) => {
          const sel = strategy.selectors.find((s) => s.type === 'css');
          if (!sel) return null;
          const u = await page.evaluate(
            (selector: string) => {
              const el = document.querySelector(selector);
              return el?.getAttribute('title') ?? el?.textContent?.trim() ?? 'Unknown';
            },
            sel.value,
          );
          return u && u !== 'Unknown' ? u : null;
        },
        tryNormal: async () => {
          const u = await page.evaluate(
            (selector: string) => {
              const el = document.querySelector(selector);
              return el?.getAttribute('title') ?? el?.textContent?.trim() ?? 'Unknown';
            },
            this.DASHBOARD_USER_SELECTOR,
          );
          return u && u !== 'Unknown'
            ? { data: u, selectors: [{ type: 'css' as const, value: this.DASHBOARD_USER_SELECTOR }] }
            : null;
        },
        htmlFingerprint: computeFingerprint(await page.content()),
      });
    } catch {
      user = await page.evaluate(
        (selector: string) => {
          const el = document.querySelector(selector);
          return el?.getAttribute('title') ?? el?.textContent?.trim() ?? 'Unknown';
        },
        this.DASHBOARD_USER_SELECTOR,
      );
    }

    const toDoItems = await page.evaluate(() => {
      const items: Array<{ title: string; course: string; dueDate?: string }> = [];
      const list = document.querySelector('#planner-todos, .to-do-list, [class*="Todo"]');
      if (!list) return items;
      for (const row of list.querySelectorAll('li, [role="listitem"], .todo')) {
        const titleEl = row.querySelector('a, [class*="title"]');
        const courseEl = row.querySelector('[class*="course"], [class*="context"]');
        const dateEl = row.querySelector('[class*="date"], time');
        const title = titleEl?.textContent?.trim();
        if (title) {
          items.push({
            title,
            course: courseEl?.textContent?.trim() ?? '',
            dueDate: dateEl?.getAttribute('datetime') ?? dateEl?.textContent?.trim(),
          });
        }
      }
      return items;
    });

    const upcomingEvents = await page.evaluate(() => {
      const items: Array<{ title: string; date: string; course?: string }> = [];
      const list = document.querySelector('#planner-events, .upcoming-events, [class*="Upcoming"]');
      if (!list) return items;
      for (const row of list.querySelectorAll('li, [role="listitem"], .event')) {
        const titleEl = row.querySelector('a, [class*="title"]');
        const dateEl = row.querySelector('[class*="date"], time');
        const courseEl = row.querySelector('[class*="course"], [class*="context"]');
        const title = titleEl?.textContent?.trim();
        if (title) {
          items.push({
            title,
            date: dateEl?.getAttribute('datetime') ?? dateEl?.textContent?.trim() ?? '',
            course: courseEl?.textContent?.trim(),
          });
        }
      }
      return items;
    });

    return { user, toDoItems, upcomingEvents };
  }

  // -------------------------------------------------------------------------
  // Private: Course list extraction via Canvas REST API
  // -------------------------------------------------------------------------

  private async extractCoursesViaApi(page: Page): Promise<ICanvasBrowserCourse[]> {
    type RawCourse = {
      id: string;
      name: string;
      course_code: string;
      teachers: Array<{ id: string; display_name: string; pronouns?: string }>;
      enrollments: Array<{ type: string; computed_current_score?: number; computed_current_grade?: string }>;
      term?: { name: string };
    };

    const raw: RawCourse[] = await page.evaluate(async () => {
      const res = await fetch(
        '/api/v1/courses?enrollment_state=active&per_page=100&include[]=teachers&include[]=total_scores&include[]=term',
      );
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    });

    return raw
      .filter(c => {
        const term = c.term?.name || '';
        if (term === 'Default Term' || !c.enrollments?.some((e: Record<string, unknown>) => e.type === 'student')) {
          return false;
        }
        return true;
      })
      .map(c => {
        const enrollment = c.enrollments?.find((e: Record<string, unknown>) => e.type === 'student');
        const score = enrollment?.computed_current_score;
        const letter = enrollment?.computed_current_grade;
        const grade = score != null ? `${score}%${letter ? ' ' + letter : ''}` : (letter || undefined);
        const periodMatch = c.course_code?.match(/p(\d+[A-Z]?)\s*-/i);

        return {
          id: String(c.id),
          name: c.name,
          courseCode: c.course_code || '',
          period: periodMatch?.[1] ? `p${periodMatch[1]}` : undefined,
          teacher: c.teachers?.[0]?.display_name || undefined,
          teachers: (c.teachers || []).map(t => {
            const displayName = t.display_name || '';
            const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(displayName);
            return {
              id: String(t.id),
              name: looksLikeEmail ? displayName.split('@')[0]! : displayName,
              email: looksLikeEmail ? displayName : undefined,
              pronouns: t.pronouns,
            };
          }),
          term: c.term?.name || undefined,
          url: `${this.baseUrl}/courses/${c.id}`,
          grade,
          assignments: [],
          modules: [],
          files: [],
        };
      });
  }

  // -------------------------------------------------------------------------
  // Private: Course detail extraction
  // -------------------------------------------------------------------------

  private async extractCourseDetail(page: Page, course: ICanvasBrowserCourse): Promise<ICanvasBrowserCourse> {
    try {
      await page.goto(course.url, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1500);

      // Assignments via Canvas REST API (ISO dates, submission status)
      let assignments: ICanvasBrowserAssignment[] = [];
      try {
        assignments = await page.evaluate(async (cid: string) => {
          const res = await fetch(
            `/api/v1/courses/${cid}/assignments?include[]=submission&per_page=200&order_by=due_at`,
          );
          if (!res.ok) return [];
          const json = await res.json();
          return (Array.isArray(json) ? json : []).map((a: Record<string, unknown>) => {
            const sub = a['submission'] as Record<string, unknown> | undefined;
            let status: string | undefined;
            if (sub) {
              if (sub['missing']) status = 'Missing';
              else if (sub['late']) status = 'Late';
              else if (sub['workflow_state'] === 'graded') status = 'Graded';
              else if (sub['workflow_state'] === 'submitted') status = 'Submitted';
              else if (sub['workflow_state'] === 'unsubmitted') status = 'Unsubmitted';
            }
            
            // Extract attachments from submission
            const attachments = [];
            if (sub && Array.isArray(sub['attachments'])) {
              for (const att of sub['attachments']) {
                const attObj = att as Record<string, unknown>;
                attachments.push({
                  name: (attObj['display_name'] || attObj['filename'] || '') as string,
                  url: attObj['url'] as string | undefined,
                  contentType: attObj['content-type'] as string | undefined,
                });
              }
            }
            
            const pts = a['points_possible'];
            return {
              name: (a['name'] as string) || '',
              dueDate: (a['due_at'] as string) || undefined,
              points: pts != null ? `${pts} pts` : undefined,
              status,
              attachments: attachments.length > 0 ? attachments : undefined,
            };
          }).filter((x: { name: string }) => x.name);
        }, course.id);
      } catch {
        assignments = [];
      }

      // Teacher emails via Canvas users API
      let teachers = course.teachers;
      try {
        const teacherDetails: ICanvasBrowserTeacher[] = await page.evaluate(async (cid: string) => {
          const res = await fetch(
            `/api/v1/courses/${cid}/users?enrollment_type[]=teacher&include[]=email&include[]=bio&per_page=50`,
          );
          if (!res.ok) return [];
          const json = await res.json();
          return (Array.isArray(json) ? json : []).map((u: Record<string, unknown>) => {
            const displayName = (u['name'] as string) || (u['display_name'] as string) || '';
            const apiEmail = (u['email'] as string) || undefined;
            const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(displayName);
            return {
              id: String(u['id'] ?? ''),
              name: looksLikeEmail ? displayName.split('@')[0]! : displayName,
              email: apiEmail || (looksLikeEmail ? displayName : undefined),
              bio: (u['bio'] as string) || undefined,
              pronouns: (u['pronouns'] as string) || undefined,
            };
          }).filter((t: { name: string }) => t.name);
        }, course.id);
        if (teacherDetails.length > 0) teachers = teacherDetails;
      } catch {
        // keep teachers from course list API
      }

      const modules: ICanvasBrowserModule[] = await page.evaluate(() => {
        const mods: Array<{ name: string; items: string[] }> = [];
        for (const mod of document.querySelectorAll('.module, [class*="Module"]')) {
          const nameEl = mod.querySelector('.name, [class*="title"], h3');
          const name = nameEl?.textContent?.trim() ?? 'Module';
          const items: string[] = [];
          for (const item of mod.querySelectorAll('.module_item, [class*="module_item"], .item')) {
            const t = item.querySelector('a, .title')?.textContent?.trim();
            if (t) items.push(t);
          }
          mods.push({ name, items });
        }
        return mods;
      });

      let files: ICanvasBrowserFile[] = [];
      try {
        files = await page.evaluate(async (cid: string) => {
          const res = await fetch(`/api/v1/courses/${cid}/files?per_page=200`);
          if (!res.ok) return [];
          const json = await res.json();
          const list = Array.isArray(json) ? json : [];
          return list.map((f: Record<string, unknown>) => ({
            name: (f['display_name'] || f['filename'] || 'file') as string,
            url: ((f['url'] as string) ?? '').replace(/\?.*$/, '').replace(/\/download$/, '') + '/download',
            size: f['size'] ? String(f['size']) : undefined,
          })).filter((x: { url: string }) => x.url !== '/download');
        }, course.id);
      } catch {
        files = [];
      }

      return { ...course, teachers, assignments, modules, files };
    } catch {
      return course;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Announcements via Canvas REST API
  // -------------------------------------------------------------------------

  private async extractAnnouncementsViaApi(
    page: Page,
    courseIds: string[],
  ): Promise<ICanvasBrowserAnnouncement[]> {
    if (courseIds.length === 0) return [];
    try {
      return await page.evaluate(async (ids: string[]) => {
        const params = ids.map(id => `context_codes[]=course_${id}`).join('&');
        const res = await fetch(`/api/v1/announcements?${params}&per_page=50`);
        if (!res.ok) return [];
        const json = await res.json();
        return (Array.isArray(json) ? json : []).map((a: Record<string, unknown>) => ({
          title: (a['title'] as string) || '',
          course: ((a['context_code'] as string) || '').replace('course_', ''),
          date: (a['posted_at'] as string) || undefined,
        })).filter((x: { title: string }) => x.title);
      }, courseIds);
    } catch {
      return [];
    }
  }
}

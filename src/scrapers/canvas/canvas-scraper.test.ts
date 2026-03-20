/**
 * Canvas scraper lifecycle tests — mock Playwright, assert initialize/auth/scrape/transform/cleanup.
 */

import { chromium } from 'playwright';
import { CanvasScraper } from './canvas-scraper';
import {
  createMockPage,
  createMockContext,
  createMockBrowser,
} from '../__mocks__/playwright-mock';
import type { IScraperConfig } from '../../core/scraper-types';
jest.mock('playwright');

const defaultConfig: IScraperConfig = {
  provider: 'canvas',
  adapterId: 'com.instructure.canvas',
  credentials: {
    baseUrl: 'https://example.instructure.com',
    username: 'student@example.com',
    password: 'secret',
  },
  studentExternalId: 'stu-1',
  institutionExternalId: 'inst-1',
  studentName: 'Student',
  sourceId: 'src-1',
  options: { headless: true, timeout: 20000 },
};

describe('CanvasScraper', () => {
  let mockPage: ReturnType<typeof createMockPage>;
  let mockContext: ReturnType<typeof createMockContext>;
  let mockBrowser: ReturnType<typeof createMockBrowser>;

  beforeEach(() => {
    mockPage = createMockPage({ url: 'https://example.instructure.com' });
    mockContext = createMockContext();
    mockContext.newPage.mockResolvedValue(mockPage as any);
    mockBrowser = createMockBrowser();
    mockBrowser.newContext.mockResolvedValue(mockContext as any);
    (chromium as jest.Mocked<typeof chromium>).launch.mockResolvedValue(mockBrowser as any);
  });

  describe('initialize', () => {
    it('stores config and launches browser with headless option', async () => {
      const scraper = new CanvasScraper();
      await scraper.initialize(defaultConfig);

      expect(chromium.launch).toHaveBeenCalledWith({ headless: true });
      expect(mockBrowser.newContext).toHaveBeenCalled();
      expect(mockContext.newPage).toHaveBeenCalled();
      expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(20000);
    });

    it('uses headless: false when options.headless is false', async () => {
      const scraper = new CanvasScraper();
      await scraper.initialize({
        ...defaultConfig,
        options: { headless: false, timeout: 10000 },
      });

      expect(chromium.launch).toHaveBeenCalledWith({ headless: false });
      expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(10000);
    });
  });

  describe('authenticate', () => {
    it('direct login path: goto, fill credentials, click submit', async () => {
      mockPage.url.mockReturnValueOnce('https://example.instructure.com').mockReturnValue('https://example.instructure.com/dashboard');
      const scraper = new CanvasScraper();
      await scraper.initialize(defaultConfig);

      const result = await scraper.authenticate();

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://example.instructure.com',
        expect.objectContaining({ waitUntil: 'networkidle' }),
      );
      expect(mockPage.locator).toHaveBeenCalled();
      const loc = mockPage.locator.mock.results[0]?.value;
      expect(loc?.fill).toHaveBeenCalledWith('student@example.com');
      expect(loc?.fill).toHaveBeenCalledWith('secret');
      expect(loc?.click).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('Google SSO path: performs Google login when URL contains accounts.google.com', async () => {
      // url() is read twice before loginViaGoogle: once for currentUrl, once for the inner if-check
      mockPage.url
        .mockReturnValueOnce('https://accounts.google.com/signin')
        .mockReturnValueOnce('https://accounts.google.com/signin')
        .mockReturnValue('https://example.instructure.com/dashboard');
      const scraper = new CanvasScraper();
      await scraper.initialize(defaultConfig);

      const result = await scraper.authenticate();

      expect(mockPage.goto).toHaveBeenCalled();
      expect(mockPage.waitForSelector).toHaveBeenCalled();
      expect(mockPage.fill).toHaveBeenCalledWith(
        expect.stringContaining('email'),
        'student@example.com',
      );
      expect(mockPage.click).toHaveBeenCalled();
      expect(mockPage.waitForURL).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('auth failure: returns success false when final URL is still login', async () => {
      mockPage.url.mockReturnValueOnce('https://example.instructure.com').mockReturnValue('https://example.instructure.com/login');
      const scraper = new CanvasScraper();
      await scraper.initialize(defaultConfig);

      const result = await scraper.authenticate();

      expect(result.success).toBe(false);
      expect(result.message).toContain('login');
    });
  });

  describe('scrape', () => {
    it('returns well-shaped extract from mocked page.evaluate', async () => {
      const scraper = new CanvasScraper();
      await scraper.initialize(defaultConfig);

      const user = 'Test User';
      const toDoItems: Array<{ title: string; course: string; dueDate?: string }> = [];
      const upcomingEvents: Array<{ title: string; date: string; course?: string }> = [];
      const apiCourseList = [
        {
          id: 101,
          name: 'Math',
          course_code: 'p1-MATH',
          teachers: [{ id: 50, display_name: 'Mrs. Teacher' }],
          enrollments: [{ type: 'student', computed_current_score: 90, computed_current_grade: 'A' }],
          term: { name: 'Spring 2026' },
        },
      ];
      const assignments: Array<{ name: string; dueDate?: string; points?: string; status?: string }> = [];
      const teacherDetails: Array<{ id: string; name: string; email?: string }> = [
        { id: '50', name: 'Mrs. Teacher', email: 'teacher@school.edu' },
      ];
      const modules: Array<{ name: string; items: string[] }> = [];
      const files: Array<{ name: string; url: string; size?: string }> = [];
      const announcements: Array<{ title: string; course: string; date?: string }> = [];

      let evalCall = 0;
      mockPage.evaluate.mockImplementation(() => {
        evalCall += 1;
        // Dashboard: user, toDoItems, upcomingEvents
        if (evalCall === 1) return Promise.resolve(user);
        if (evalCall === 2) return Promise.resolve(toDoItems);
        if (evalCall === 3) return Promise.resolve(upcomingEvents);
        // Course list (API)
        if (evalCall === 4) return Promise.resolve(apiCourseList);
        // Course detail: assignments (API), teachers (API), modules (DOM), files (API)
        if (evalCall === 5) return Promise.resolve(assignments);
        if (evalCall === 6) return Promise.resolve(teacherDetails);
        if (evalCall === 7) return Promise.resolve(modules);
        if (evalCall === 8) return Promise.resolve(files);
        // Announcements (API)
        if (evalCall === 9) return Promise.resolve(announcements);
        return Promise.resolve(null);
      });

      const result = await scraper.scrape();

      expect(result).toHaveProperty('user', user);
      expect(result).toHaveProperty('courses');
      expect(Array.isArray((result as any).courses)).toBe(true);
      expect((result as any).courses[0]).toMatchObject({
        id: '101',
        name: 'Math',
        courseCode: 'p1-MATH',
      });
      expect(result).toHaveProperty('toDoItems');
      expect(result).toHaveProperty('upcomingEvents');
      expect(result).toHaveProperty('announcements');
      expect(result).toHaveProperty('timestamp');
    });
  });

  describe('transform', () => {
    it('delegates to transformCanvasExtract and produces valid ops', () => {
      const spy = jest.spyOn(
        require('./canvas-transformer'),
        'transformCanvasExtract',
      ) as jest.SpyInstance;
      const scraper = new CanvasScraper();
      (scraper as any).config = defaultConfig;

      const extract = {
        user: 'Student',
        courses: [],
        toDoItems: [],
        upcomingEvents: [],
        announcements: [],
        timestamp: new Date().toISOString(),
      };
      const ops = scraper.transform(extract as any);

      expect(spy).toHaveBeenCalledWith(
        extract,
        expect.objectContaining({
          provider: 'canvas',
          adapterId: 'com.instructure.canvas',
          studentExternalId: 'stu-1',
          institutionExternalId: 'inst-1',
        }),
      );
      expect(Array.isArray(ops)).toBe(true);
      spy.mockRestore();
    });
  });

  describe('cleanup', () => {
    it('closes the browser', async () => {
      const scraper = new CanvasScraper();
      await scraper.initialize(defaultConfig);
      await scraper.cleanup();

      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });

  describe('metadata', () => {
    it('loads from metadata.json', () => {
      const scraper = new CanvasScraper();
      expect(scraper.metadata.id).toBe('canvas-browser');
      expect(scraper.metadata.name).toBe('Canvas LMS');
      expect(scraper.metadata.platforms).toContain('*.instructure.com');
      expect(scraper.metadata.capabilities.grades).toBe(true);
    });
  });

  describe('run', () => {
    it('full lifecycle produces valid envelope', async () => {
      const scraper = new CanvasScraper();
      mockPage.url.mockReturnValue('https://example.instructure.com');
      const loc = mockPage.locator();
      loc.count.mockResolvedValue(1);

      const user = 'Run User';
      const apiCourseList = [
        {
          id: 1,
          name: 'Course',
          course_code: 'C',
          teachers: [{ id: 10, display_name: 'T' }],
          enrollments: [{ type: 'student', computed_current_score: 95, computed_current_grade: 'A' }],
        },
      ];
      let evalCall = 0;
      mockPage.evaluate.mockImplementation(() => {
        evalCall += 1;
        // Dashboard: user, toDoItems, upcomingEvents
        if (evalCall === 1) return Promise.resolve(user);
        if (evalCall === 2) return Promise.resolve([]);
        if (evalCall === 3) return Promise.resolve([]);
        // Course list (API)
        if (evalCall === 4) return Promise.resolve(apiCourseList);
        // Course detail: assignments (API), teachers (API), modules (DOM), files (API)
        if (evalCall === 5) return Promise.resolve([]);
        if (evalCall === 6) return Promise.resolve([]);
        if (evalCall === 7) return Promise.resolve([]);
        if (evalCall === 8) return Promise.resolve([]);
        // Announcements (API)
        if (evalCall === 9) return Promise.resolve([]);
        return Promise.resolve(null);
      });

      const envelope = await scraper.run(defaultConfig);

      expect(envelope).toHaveProperty('schemaVersion');
      expect(envelope).toHaveProperty('run');
      expect(envelope.run).toHaveProperty('runId');
      expect(envelope.run).toHaveProperty('provider', 'canvas');
      expect(envelope).toHaveProperty('ops');
      expect(Array.isArray(envelope.ops)).toBe(true);
    });
  });
});

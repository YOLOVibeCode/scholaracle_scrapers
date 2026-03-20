/**
 * Skyward scraper lifecycle tests — mock Playwright, assert initialize/auth/scrape/transform/cleanup + popup.
 */

import { chromium } from 'playwright';
import { SkywardScraper } from './skyward-scraper';
import {
  createMockPage,
  createMockContext,
  createMockBrowser,
} from '../__mocks__/playwright-mock';
import type { IScraperConfig } from '../../core/scraper-types';

jest.mock('playwright');

const defaultConfig: IScraperConfig = {
  provider: 'skyward',
  adapterId: 'com.skyward.iscorp',
  credentials: {
    baseUrl: 'https://skyward.example.com',
    username: 'parent@example.com',
    password: 'secret',
  },
  studentExternalId: 'stu-1',
  institutionExternalId: 'inst-1',
  studentName: 'Student',
  sourceId: 'src-1',
  options: { headless: true, timeout: 20000 },
};

describe('SkywardScraper', () => {
  let mockPage: ReturnType<typeof createMockPage>;
  let mockContext: ReturnType<typeof createMockContext>;
  let mockBrowser: ReturnType<typeof createMockBrowser>;

  beforeEach(() => {
    mockPage = createMockPage({ url: 'https://skyward.example.com' });
    mockContext = createMockContext();
    mockContext.newPage.mockResolvedValue(mockPage as any);
    mockBrowser = createMockBrowser();
    mockBrowser.newContext.mockResolvedValue(mockContext as any);
    (chromium as jest.Mocked<typeof chromium>).launch.mockResolvedValue(mockBrowser as any);
  });

  describe('initialize', () => {
    it('stores config and launches browser with headless option', async () => {
      const scraper = new SkywardScraper();
      await scraper.initialize(defaultConfig);

      expect(chromium.launch).toHaveBeenCalledWith({ headless: true });
      expect(mockBrowser.newContext).toHaveBeenCalled();
      expect(mockContext.newPage).toHaveBeenCalled();
      expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(20000);
    });
  });

  describe('authenticate', () => {
    it('navigates, fills credentials, clicks login via password path', async () => {
      // Force the password path by ensuring the Google login button check returns 0
      const sharedLoc = mockPage.locator('_');
      sharedLoc.count.mockResolvedValue(0);
      mockPage.url.mockReturnValueOnce('https://skyward.example.com').mockReturnValue('https://skyward.example.com/home');
      const scraper = new SkywardScraper();
      await scraper.initialize(defaultConfig);

      const result = await scraper.authenticate();

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://skyward.example.com',
        expect.objectContaining({ waitUntil: 'networkidle' }),
      );
      expect(mockPage.locator).toHaveBeenCalled();
      expect(sharedLoc.fill).toHaveBeenCalledWith('parent@example.com');
      expect(sharedLoc.fill).toHaveBeenCalledWith('secret');
      expect(sharedLoc.click).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('handles popup via context.on("page") and uses popup as main page', async () => {
      // Force password path (no Google login button)
      const sharedLoc = mockPage.locator('_');
      sharedLoc.count.mockResolvedValue(0);

      const popupPage = createMockPage({ url: 'https://skyward.example.com/home' });
      popupPage.url.mockReturnValue('https://skyward.example.com/home');
      mockPage.url.mockReturnValue('https://skyward.example.com/login');
      let pageHandler: ((p: unknown) => void) | undefined;
      mockContext.on.mockImplementation((ev: string, fn: (p: unknown) => void) => {
        if (ev === 'page') pageHandler = fn;
      });
      mockPage.waitForTimeout.mockImplementation(async () => {
        if (pageHandler) pageHandler(popupPage);
      });
      const scraper = new SkywardScraper();
      await scraper.initialize(defaultConfig);

      const result = await scraper.authenticate();

      expect(mockContext.on).toHaveBeenCalledWith('page', expect.any(Function));
      expect(result.success).toBe(true);
    });

    it('auth failure when final URL still contains seplog (Skyward login page)', async () => {
      // Force password path (no Google login button)
      const sharedLoc = mockPage.locator('_');
      sharedLoc.count.mockResolvedValue(0);
      // Skyward checks for 'seplog' in URL to detect failed login, not 'login'
      mockPage.url.mockReturnValue('https://skyward.example.com/seplog01.w');
      const scraper = new SkywardScraper();
      await scraper.initialize(defaultConfig);

      const result = await scraper.authenticate();

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/seplog/);
    });
  });

  describe('scrape', () => {
    it('returns well-shaped extract from mocked evaluate and content', async () => {
      const { createMockLocator } = require('../__mocks__/playwright-mock');
      const loc = createMockLocator();
      loc.count.mockResolvedValue(0);
      loc.first.mockReturnValue(loc);
      mockPage.locator.mockReturnValue(loc);
      mockPage.evaluate
        .mockResolvedValueOnce('Student Name')
        .mockResolvedValueOnce('School Name')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockPage.content.mockResolvedValue('<html><body></body></html>');

      const scraper = new SkywardScraper();
      await scraper.initialize(defaultConfig);

      const result = await scraper.scrape();

      expect(result).toHaveProperty('student');
      expect(result).toHaveProperty('school');
      expect(result).toHaveProperty('courses');
      expect(result).toHaveProperty('assignments');
      expect(result).toHaveProperty('missingAssignments');
      expect(result).toHaveProperty('attendance');
      expect(result).toHaveProperty('schedule');
      expect(result).toHaveProperty('timestamp');
    });

    it('returns non-empty assignments when gradebook HTML includes assignment detail table', async () => {
      const { createMockLocator } = require('../__mocks__/playwright-mock');
      const showAllLoc = createMockLocator();
      showAllLoc.count.mockResolvedValue(0);
      showAllLoc.first.mockReturnValue(showAllLoc);
      mockPage.locator.mockReturnValue(showAllLoc);
      mockPage.evaluate
        .mockResolvedValueOnce('Ava Johnson')
        .mockResolvedValueOnce('Lincoln High School')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const gradebookWithAssignments = [
        'Missing Assignments',
        'Class Grades',
        '<table id="classDesc_1_2_3_4"><tr><td class="bld classDesc"><a href="#">AP Mathematics</a></td></tr>',
        '<label>Period</label> 3',
        'grid_stuGradesGrid',
        '<table id="stuAssignmentSummaryGrid">',
        '<tr><td>Assignment</td><td>Category</td><td>Due Date</td><td>Points Earned</td><td>Points Possible</td><td>Grade</td></tr>',
        '<tr><td>Quiz 1</td><td>Major</td><td>02/10/2026</td><td>95</td><td>100</td><td>95</td></tr>',
        '</table>',
      ].join('\n');
      mockPage.content.mockResolvedValue(`<html><body>${gradebookWithAssignments}</body></html>`);

      const scraper = new SkywardScraper();
      await scraper.initialize(defaultConfig);

      const result = await scraper.scrape();

      expect(result.assignments).toBeDefined();
      expect(Array.isArray(result.assignments)).toBe(true);
      expect((result.assignments as unknown[]).length).toBeGreaterThan(0);
      const first = (result.assignments as Record<string, unknown>[])[0];
      expect(first).toMatchObject({
        title: 'Quiz 1',
        course: expect.any(String),
        period: expect.any(String),
        category: 'Major',
        dueDate: '02/10/2026',
        pointsEarned: '95',
        pointsPossible: '100',
        grade: '95',
        status: 'graded',
      });
    });
  });

  describe('transform', () => {
    it('delegates to transformSkywardExtract', () => {
      const spy = jest.spyOn(
        require('./skyward-transformer'),
        'transformSkywardExtract',
      ) as jest.SpyInstance;
      const scraper = new SkywardScraper();
      (scraper as any).config = defaultConfig;

      const extract = {
        student: 'S',
        school: 'School',
        courses: [],
        missingAssignments: [],
        assignments: [],
        attendance: [],
        schedule: [],
        timestamp: new Date().toISOString(),
      };
      scraper.transform(extract as any);

      expect(spy).toHaveBeenCalledWith(
        extract,
        expect.objectContaining({
          provider: 'skyward',
          adapterId: 'com.skyward.iscorp',
          studentExternalId: 'stu-1',
          institutionExternalId: 'inst-1',
        }),
      );
      spy.mockRestore();
    });
  });

  describe('cleanup', () => {
    it('closes the browser', async () => {
      const scraper = new SkywardScraper();
      await scraper.initialize(defaultConfig);
      await scraper.cleanup();

      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });

  describe('metadata', () => {
    it('loads from metadata.json', () => {
      const scraper = new SkywardScraper();
      expect(scraper.metadata.id).toBe('skyward-browser');
      expect(scraper.metadata.name).toBe('Skyward Family Access');
      expect(scraper.metadata.platforms).toContain('skyward.*');
      expect(scraper.metadata.capabilities.grades).toBe(true);
    });
  });
});

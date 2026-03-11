/**
 * Aeries scraper lifecycle tests — mock Playwright, assert initialize/auth/scrape/transform/cleanup
 * and two-step login + multi-student extraction.
 */

import { chromium } from 'playwright';
import { AeriesScraper } from './aeries-scraper';
import {
  createMockPage,
  createMockContext,
  createMockBrowser,
  createMockLocator,
} from '../__mocks__/playwright-mock';
import type { IScraperConfig } from '../../core/types';

jest.mock('playwright');

const defaultConfig: IScraperConfig = {
  provider: 'aeries',
  adapterId: 'com.aeries.portal',
  credentials: {
    baseUrl: 'https://portal.aeries.net',
    username: 'parent@example.com',
    password: 'secret',
  },
  studentExternalId: 'stu-1',
  institutionExternalId: 'inst-1',
  studentName: 'Student',
  sourceId: 'src-1',
  options: { headless: true, timeout: 20000 },
};

describe('AeriesScraper', () => {
  let mockPage: ReturnType<typeof createMockPage>;
  let mockContext: ReturnType<typeof createMockContext>;
  let mockBrowser: ReturnType<typeof createMockBrowser>;

  beforeEach(() => {
    mockPage = createMockPage({ url: 'https://portal.aeries.net' });
    mockContext = createMockContext();
    mockContext.newPage.mockResolvedValue(mockPage as any);
    mockBrowser = createMockBrowser();
    mockBrowser.newContext.mockResolvedValue(mockContext as any);
    (chromium as jest.Mocked<typeof chromium>).launch.mockResolvedValue(mockBrowser as any);
  });

  describe('initialize', () => {
    it('stores config and launches browser with headless option', async () => {
      const scraper = new AeriesScraper();
      await scraper.initialize(defaultConfig);

      expect(chromium.launch).toHaveBeenCalledWith({ headless: true });
      expect(mockBrowser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ viewport: { width: 1280, height: 900 } }),
      );
      expect(mockContext.newPage).toHaveBeenCalled();
      expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(20000);
    });
  });

  describe('authenticate', () => {
    it('two-step login: email -> Next -> password -> Sign In', async () => {
      mockPage.url.mockReturnValue('https://portal.aeries.net/student/Dashboard.aspx');
      const scraper = new AeriesScraper();
      await scraper.initialize(defaultConfig);

      const result = await scraper.authenticate();

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://portal.aeries.net',
        expect.objectContaining({ waitUntil: 'networkidle' }),
      );
      expect(mockPage.locator).toHaveBeenCalled();
      const loc = mockPage.locator.mock.results[0]?.value;
      expect(loc?.fill).toHaveBeenCalledWith('parent@example.com');
      expect(loc?.click).toHaveBeenCalled();
      expect(mockPage.waitForTimeout).toHaveBeenCalled();
      expect(loc?.waitFor).toHaveBeenCalled();
      expect(loc?.fill).toHaveBeenCalledWith('secret');
      expect(result.success).toBe(true);
    });

    it('auth failure when final URL contains LoginParent or login', async () => {
      mockPage.url.mockReturnValue('https://portal.aeries.net/LoginParent');
      const scraper = new AeriesScraper();
      await scraper.initialize(defaultConfig);

      const result = await scraper.authenticate();

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/login|LoginParent/);
    });
  });

  describe('scrape', () => {
    it('returns well-shaped extract with students and courses', async () => {
      mockPage.url.mockReturnValue('https://portal.aeries.net/student/Dashboard.aspx');
      mockPage.evaluate
        .mockResolvedValueOnce([{ name: 'Student One', grade: '10', school: 'High School' }])
        .mockResolvedValueOnce([
          {
            period: '1',
            name: 'Math',
            term: 'Q1',
            teacher: 'Teacher',
            teacherEmail: '',
            room: '101',
            currentGrade: 90,
            currentPercent: 90.5,
            missingCount: 0,
            assignments: [],
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ name: 'Student One', studentId: '123', grade: '10', school: 'High School' })
        .mockResolvedValueOnce([]);
      const loc = createMockLocator();
      loc.waitFor.mockResolvedValue(undefined);
      mockPage.locator.mockReturnValue(loc);

      const scraper = new AeriesScraper();
      await scraper.initialize(defaultConfig);

      const result = await scraper.scrape();

      expect(result).toHaveProperty('students');
      expect(Array.isArray((result as any).students)).toBe(true);
      expect((result as any).students[0]).toMatchObject({
        name: expect.any(String),
        courses: expect.any(Array),
        attendance: expect.any(Array),
      });
      expect(result).toHaveProperty('timestamp');
    });

    it('multi-student: extracts multiple students when dashboard returns more than one', async () => {
      mockPage.url.mockReturnValue('https://portal.aeries.net/student/Dashboard.aspx');
      const students1 = [
        { name: 'Student One', grade: '10', school: 'HS' },
        { name: 'Student Two', grade: '8', school: 'MS' },
      ];
      const courses1 = [
        {
          period: '1',
          name: 'Math',
          term: 'Q1',
          teacher: 'T',
          teacherEmail: '',
          room: '1',
          currentGrade: 85,
          currentPercent: 85,
          missingCount: 0,
          assignments: [],
        },
      ];
      const emptyCourseOpts: Array<{ value: string; text: string }> = [];
      let evalCall = 0;
      mockPage.evaluate.mockImplementation(() => {
        evalCall += 1;
        if (evalCall === 1) return Promise.resolve(students1);
        if (evalCall === 2) return Promise.resolve(courses1);
        if (evalCall === 3) return Promise.resolve(emptyCourseOpts);
        if (evalCall === 4) return Promise.resolve({ name: 'Student One', studentId: '1', grade: '10', school: 'HS' });
        if (evalCall === 5) return Promise.resolve([]);
        if (evalCall === 6) return Promise.resolve(students1);
        if (evalCall === 7) return Promise.resolve(courses1);
        if (evalCall === 8) return Promise.resolve(emptyCourseOpts);
        if (evalCall === 9) return Promise.resolve({ name: 'Student Two', studentId: '2', grade: '8', school: 'MS' });
        if (evalCall === 10) return Promise.resolve([]);
        return Promise.resolve([]);
      });
      const loc = createMockLocator();
      loc.waitFor.mockResolvedValue(undefined);
      loc.count.mockResolvedValue(1);
      loc.click.mockResolvedValue(undefined);
      mockPage.locator.mockReturnValue(loc);

      const scraper = new AeriesScraper();
      await scraper.initialize(defaultConfig);

      const result = await scraper.scrape();

      expect((result as any).students.length).toBeGreaterThanOrEqual(1);
      expect(result).toHaveProperty('timestamp');
    });
  });

  describe('transform', () => {
    it('delegates to transformAeriesExtract', () => {
      const spy = jest.spyOn(
        require('./aeries-transformer'),
        'transformAeriesExtract',
      ) as jest.SpyInstance;
      const scraper = new AeriesScraper();
      (scraper as any).config = defaultConfig;

      const extract = {
        students: [
          {
            name: 'S',
            studentId: '1',
            grade: '10',
            school: 'School',
            courses: [],
            attendance: [],
          },
        ],
        timestamp: new Date().toISOString(),
      };
      scraper.transform(extract as any);

      expect(spy).toHaveBeenCalledWith(
        extract,
        expect.objectContaining({
          provider: 'aeries',
          adapterId: 'com.aeries.portal',
          studentExternalId: 'stu-1',
          institutionExternalId: 'inst-1',
        }),
      );
      spy.mockRestore();
    });
  });

  describe('cleanup', () => {
    it('closes the browser', async () => {
      const scraper = new AeriesScraper();
      await scraper.initialize(defaultConfig);
      await scraper.cleanup();

      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });

  describe('metadata', () => {
    it('loads from metadata.json', () => {
      const scraper = new AeriesScraper();
      expect(scraper.metadata.id).toBe('aeries-browser');
      expect(scraper.metadata.name).toBe('Aeries Parent Portal');
      expect(scraper.metadata.platforms).toContain('*.aeries.net');
      expect(scraper.metadata.capabilities.grades).toBe(true);
    });
  });
});

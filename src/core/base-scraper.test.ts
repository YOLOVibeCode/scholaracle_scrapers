import { BaseScraper } from './base-scraper';
import type {
  IScraperConfig,
  IScraperMetadata,
  ISlcDeltaOp,
  ISlcIngestEnvelopeV1,
} from './types';

// ---------------------------------------------------------------------------
// Concrete test implementation of BaseScraper
// ---------------------------------------------------------------------------

class TestScraper extends BaseScraper {
  public initCalled = false;
  public authCalled = false;
  public scrapeCalled = false;
  public cleanupCalled = false;

  get metadata(): IScraperMetadata {
    return {
      id: 'test-scraper',
      name: 'Test Platform',
      version: '1.0.0',
      description: 'A test scraper',
      platforms: ['test.example.com'],
      capabilities: {
        grades: true,
        assignments: true,
        attendance: false,
        schedule: false,
        messages: false,
        documents: false,
      },
    };
  }

  async initialize(config: IScraperConfig): Promise<void> {
    this.initCalled = true;
    this.config = config;
  }

  async authenticate(): Promise<{ success: boolean; message?: string }> {
    this.authCalled = true;
    return { success: true };
  }

  async scrape(): Promise<Record<string, unknown>> {
    this.scrapeCalled = true;
    return {
      courses: [{ name: 'Math', grade: 'A' }],
      assignments: [{ title: 'HW 1', points: 100 }],
    };
  }

  transform(rawData: Record<string, unknown>): ISlcDeltaOp[] {
    const courses = (rawData['courses'] ?? []) as Array<{ name: string }>;
    const assignments = (rawData['assignments'] ?? []) as Array<{ title: string; points: number }>;

    const ops: ISlcDeltaOp[] = [];
    const now = new Date().toISOString();

    for (const c of courses) {
      ops.push({
        op: 'upsert',
        entity: 'course',
        key: {
          provider: this.config!.provider,
          adapterId: this.config!.adapterId,
          externalId: `course-${c.name}`,
          studentExternalId: this.config!.studentExternalId,
          institutionExternalId: this.config!.institutionExternalId,
        },
        observedAt: now,
        record: { title: c.name },
      });
    }

    for (const a of assignments) {
      ops.push({
        op: 'upsert',
        entity: 'assignment',
        key: {
          provider: this.config!.provider,
          adapterId: this.config!.adapterId,
          externalId: `assignment-${a.title}`,
          studentExternalId: this.config!.studentExternalId,
          institutionExternalId: this.config!.institutionExternalId,
        },
        observedAt: now,
        record: { title: a.title, pointsPossible: a.points },
      });
    }

    return ops;
  }

  async cleanup(): Promise<void> {
    this.cleanupCalled = true;
  }
}

// Scraper that fails auth
class FailAuthScraper extends TestScraper {
  async authenticate(): Promise<{ success: boolean; message?: string }> {
    return { success: false, message: 'Bad credentials' };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testConfig: IScraperConfig = {
  credentials: {
    baseUrl: 'https://test.example.com',
    username: 'user@test.com',
    password: 'pass123',
  },
  studentName: 'Emma',
  studentExternalId: 'stu-1',
  institutionExternalId: 'inst-1',
  sourceId: 'source-1',
  provider: 'test',
  adapterId: 'com.test.adapter',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseScraper', () => {
  describe('strategyStore', () => {
    it('has optional strategyStore property', () => {
      const scraper = new TestScraper();
      expect(scraper.strategyStore).toBeUndefined();
      const mockStore = {
        get: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue(undefined),
        invalidate: jest.fn().mockResolvedValue(undefined),
      };
      scraper.strategyStore = mockStore as never;
      expect(scraper.strategyStore).toBe(mockStore);
    });
  });

  describe('metadata', () => {
    it('should expose scraper metadata', () => {
      const scraper = new TestScraper();
      expect(scraper.metadata.id).toBe('test-scraper');
      expect(scraper.metadata.name).toBe('Test Platform');
      expect(scraper.metadata.version).toBe('1.0.0');
    });
  });

  describe('discoverStudents', () => {
    it('returns single student from config by default', async () => {
      const scraper = new TestScraper();
      await scraper.initialize(testConfig);
      const students = await scraper.discoverStudents();
      expect(students).toHaveLength(1);
      expect(students[0].externalId).toBe('stu-1');
      expect(students[0].displayName).toBe('Emma');
    });

    it('returns default student when config has no studentExternalId', async () => {
      const scraper = new TestScraper();
      await scraper.initialize({
        ...testConfig,
        studentExternalId: '',
        studentName: '',
        credentials: { ...testConfig.credentials, studentNameHint: 'Hint' },
      });
      const students = await scraper.discoverStudents();
      expect(students).toHaveLength(1);
      expect(students[0].externalId).toBe('default');
      expect(students[0].displayName).toBe('Hint');
    });
  });

  describe('switchToStudent', () => {
    it('resolves without error by default', async () => {
      const scraper = new TestScraper();
      await scraper.switchToStudent('any-id');
    });
  });

  describe('run()', () => {
    it('should execute the full lifecycle: init -> auth -> scrape -> transform -> envelope', async () => {
      const scraper = new TestScraper();
      const envelope = await scraper.run(testConfig);

      expect(scraper.initCalled).toBe(true);
      expect(scraper.authCalled).toBe(true);
      expect(scraper.scrapeCalled).toBe(true);
      expect(scraper.cleanupCalled).toBe(true);

      expect(envelope).toBeDefined();
      expect(envelope.schemaVersion).toBe('slc.ingest.v1');
      expect(envelope.run.provider).toBe('test');
      expect(envelope.run.adapterId).toBe('com.test.adapter');
      expect(envelope.run.mode).toBe('delta');
      expect(envelope.source.sourceId).toBe('source-1');
      expect(envelope.ops.length).toBe(2);
    });

    it('should produce valid ops from the transform', async () => {
      const scraper = new TestScraper();
      const envelope = await scraper.run(testConfig);

      const courseOp = envelope.ops.find(o => o.entity === 'course');
      expect(courseOp).toBeDefined();
      expect(courseOp!.op).toBe('upsert');
      expect((courseOp!.record as any).title).toBe('Math');

      const assignmentOp = envelope.ops.find(o => o.entity === 'assignment');
      expect(assignmentOp).toBeDefined();
      expect((assignmentOp!.record as any).title).toBe('HW 1');
    });

    it('should set run timestamps', async () => {
      const before = new Date().toISOString();
      const scraper = new TestScraper();
      const envelope = await scraper.run(testConfig);
      const after = new Date().toISOString();

      expect(envelope.run.startedAt >= before).toBe(true);
      expect(envelope.run.startedAt <= after).toBe(true);
      expect(envelope.run.runId).toBeDefined();
      expect(envelope.run.runId.length).toBeGreaterThan(0);
    });

    it('should call cleanup even if scrape throws', async () => {
      const scraper = new TestScraper();
      scraper.scrape = async () => { throw new Error('Scrape failed'); };

      await expect(scraper.run(testConfig)).rejects.toThrow('Scrape failed');
      expect(scraper.cleanupCalled).toBe(true);
    });

    it('should call cleanup even if auth fails', async () => {
      const scraper = new FailAuthScraper();

      await expect(scraper.run(testConfig)).rejects.toThrow('Authentication failed');
      expect(scraper.cleanupCalled).toBe(true);
    });

    it('should include adapterVersion from metadata', async () => {
      const scraper = new TestScraper();
      const envelope = await scraper.run(testConfig);
      expect(envelope.run.adapterVersion).toBe('1.0.0');
    });
  });

  describe('assembleEnvelope()', () => {
    it('should wrap ops in a valid envelope structure', () => {
      const scraper = new TestScraper();
      scraper.config = testConfig;
      const ops: ISlcDeltaOp[] = [
        {
          op: 'upsert', entity: 'assignment',
          key: { provider: 'test', adapterId: 'com.test', externalId: 'a-1' },
          observedAt: '2026-02-16T12:00:00Z',
          record: { title: 'Test' },
        },
      ];

      const envelope = scraper.assembleEnvelope(ops);
      expect(envelope.schemaVersion).toBe('slc.ingest.v1');
      expect(envelope.ops).toEqual(ops);
      expect(envelope.source.sourceId).toBe('source-1');
    });
  });
});

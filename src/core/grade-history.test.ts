import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GradeHistory, type IGradeHistoryEntry } from './grade-history';

const TEST_DIR = join(tmpdir(), 'scholaracle-grade-history-test');

function makeHistory(dir?: string): GradeHistory {
  return new GradeHistory(dir ?? TEST_DIR);
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('GradeHistory', () => {
  describe('record + load', () => {
    it('should persist a grade snapshot and retrieve it', () => {
      const h = makeHistory();
      h.record('stu-1', 'ALGEBRA 1', {
        date: '2026-02-20',
        grade: 62,
        source: 'sis',
      });
      const data = h.load('stu-1');
      expect(data.courses['ALGEBRA 1']).toBeDefined();
      expect(data.courses['ALGEBRA 1']!.snapshots).toHaveLength(1);
      expect(data.courses['ALGEBRA 1']!.snapshots[0]!.grade).toBe(62);
    });

    it('should append snapshots across multiple calls', () => {
      const h = makeHistory();
      h.record('stu-1', 'ALGEBRA 1', { date: '2026-02-20', grade: 62, source: 'sis' });
      h.record('stu-1', 'ALGEBRA 1', { date: '2026-02-22', grade: 65, source: 'sis' });
      h.record('stu-1', 'ALGEBRA 1', { date: '2026-02-25', grade: 68, source: 'sis' });

      const data = h.load('stu-1');
      expect(data.courses['ALGEBRA 1']!.snapshots).toHaveLength(3);
    });

    it('should deduplicate same-date entries (keep latest)', () => {
      const h = makeHistory();
      h.record('stu-1', 'MATH', { date: '2026-02-25', grade: 70, source: 'sis' });
      h.record('stu-1', 'MATH', { date: '2026-02-25', grade: 72, source: 'sis' });

      const data = h.load('stu-1');
      expect(data.courses['MATH']!.snapshots).toHaveLength(1);
      expect(data.courses['MATH']!.snapshots[0]!.grade).toBe(72);
    });

    it('should handle multiple courses independently', () => {
      const h = makeHistory();
      h.record('stu-1', 'MATH', { date: '2026-02-25', grade: 70, source: 'sis' });
      h.record('stu-1', 'ENGLISH', { date: '2026-02-25', grade: 85, source: 'sis' });

      const data = h.load('stu-1');
      expect(Object.keys(data.courses)).toHaveLength(2);
      expect(data.courses['MATH']!.snapshots[0]!.grade).toBe(70);
      expect(data.courses['ENGLISH']!.snapshots[0]!.grade).toBe(85);
    });

    it('should return empty for unknown student', () => {
      const h = makeHistory();
      const data = h.load('unknown');
      expect(data.courses).toEqual({});
    });
  });

  describe('computeTrend', () => {
    it('should detect improving trend', () => {
      const h = makeHistory();
      h.record('stu-1', 'MATH', { date: '2026-02-10', grade: 60, source: 'sis' });
      h.record('stu-1', 'MATH', { date: '2026-02-17', grade: 65, source: 'sis' });
      h.record('stu-1', 'MATH', { date: '2026-02-24', grade: 72, source: 'sis' });

      const trend = h.computeTrend('stu-1', 'MATH');
      expect(trend.direction).toBe('improving');
      expect(trend.velocity).toBeGreaterThan(0);
    });

    it('should detect declining trend', () => {
      const h = makeHistory();
      h.record('stu-1', 'MATH', { date: '2026-02-10', grade: 85, source: 'sis' });
      h.record('stu-1', 'MATH', { date: '2026-02-17', grade: 78, source: 'sis' });
      h.record('stu-1', 'MATH', { date: '2026-02-24', grade: 70, source: 'sis' });

      const trend = h.computeTrend('stu-1', 'MATH');
      expect(trend.direction).toBe('declining');
      expect(trend.velocity).toBeLessThan(0);
    });

    it('should detect stable trend for minimal change', () => {
      const h = makeHistory();
      h.record('stu-1', 'MATH', { date: '2026-02-10', grade: 80, source: 'sis' });
      h.record('stu-1', 'MATH', { date: '2026-02-17', grade: 81, source: 'sis' });
      h.record('stu-1', 'MATH', { date: '2026-02-24', grade: 80, source: 'sis' });

      const trend = h.computeTrend('stu-1', 'MATH');
      expect(trend.direction).toBe('stable');
    });

    it('should return unknown for single data point', () => {
      const h = makeHistory();
      h.record('stu-1', 'MATH', { date: '2026-02-24', grade: 80, source: 'sis' });

      const trend = h.computeTrend('stu-1', 'MATH');
      expect(trend.direction).toBe('unknown');
    });
  });

  describe('recordFromReconciled', () => {
    it('should batch-record reconciled grades and compute trends', () => {
      const h = makeHistory();
      // Simulate a prior run
      h.record('stu-1', 'ALGEBRA 1', { date: '2026-02-20', grade: 62, source: 'sis' });

      // Record new batch from reconciler output
      h.recordFromReconciled('stu-1', [
        { courseName: 'ALGEBRA 1', officialGrade: 65, source: 'sis' as const },
        { courseName: 'BIOLOGY', officialGrade: 77, source: 'sis' as const },
      ], '2026-02-25');

      const data = h.load('stu-1');
      expect(data.courses['ALGEBRA 1']!.snapshots).toHaveLength(2);
      expect(data.courses['BIOLOGY']!.snapshots).toHaveLength(1);

      const trend = h.computeTrend('stu-1', 'ALGEBRA 1');
      expect(trend.direction).toBe('improving');
    });
  });
});

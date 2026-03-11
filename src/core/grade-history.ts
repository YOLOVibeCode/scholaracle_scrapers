import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IReconciledGrade } from './grade-reconciler';

const STABLE_THRESHOLD = 2;

export interface IGradeHistoryEntry {
  readonly date: string;
  readonly grade: number;
  readonly source: 'sis' | 'lms';
}

export interface ICourseHistory {
  snapshots: IGradeHistoryEntry[];
}

export interface IStudentGradeHistory {
  studentExternalId: string;
  courses: Record<string, ICourseHistory>;
  lastUpdated: string;
}

export interface ITrend {
  readonly direction: 'improving' | 'declining' | 'stable' | 'unknown';
  /** Grade points per week (positive = improving). */
  readonly velocity: number;
  /** Total change from first to last snapshot. */
  readonly totalChange: number;
  readonly dataPoints: number;
}

/**
 * Persists grade snapshots across scraper runs and computes trends.
 * Storage: one JSON file per student in the history directory.
 */
export class GradeHistory {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? join(homedir(), '.scholaracle-scraper', 'grade-history');
    mkdirSync(this.dir, { recursive: true });
  }

  private filePath(studentId: string): string {
    const safe = studentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.dir, `${safe}.json`);
  }

  load(studentId: string): IStudentGradeHistory {
    const fp = this.filePath(studentId);
    if (!existsSync(fp)) {
      return { studentExternalId: studentId, courses: {}, lastUpdated: '' };
    }
    try {
      return JSON.parse(readFileSync(fp, 'utf-8')) as IStudentGradeHistory;
    } catch {
      return { studentExternalId: studentId, courses: {}, lastUpdated: '' };
    }
  }

  private save(studentId: string, data: IStudentGradeHistory): void {
    data.lastUpdated = new Date().toISOString();
    writeFileSync(this.filePath(studentId), JSON.stringify(data, null, 2), 'utf-8');
  }

  record(studentId: string, courseName: string, entry: IGradeHistoryEntry): void {
    const data = this.load(studentId);
    if (!data.courses[courseName]) {
      data.courses[courseName] = { snapshots: [] };
    }
    const course = data.courses[courseName]!;
    const existing = course.snapshots.findIndex(s => s.date === entry.date);
    if (existing >= 0) {
      course.snapshots[existing] = entry;
    } else {
      course.snapshots.push(entry);
      course.snapshots.sort((a, b) => a.date.localeCompare(b.date));
    }
    this.save(studentId, data);
  }

  recordFromReconciled(
    studentId: string,
    grades: ReadonlyArray<Pick<IReconciledGrade, 'courseName' | 'officialGrade' | 'source'>>,
    date?: string,
  ): void {
    const d = date ?? new Date().toISOString().split('T')[0]!;
    for (const g of grades) {
      if (g.officialGrade == null) continue;
      this.record(studentId, g.courseName, {
        date: d,
        grade: g.officialGrade,
        source: g.source,
      });
    }
  }

  computeTrend(studentId: string, courseName: string): ITrend {
    const data = this.load(studentId);
    const course = data.courses[courseName];
    if (!course || course.snapshots.length < 2) {
      return { direction: 'unknown', velocity: 0, totalChange: 0, dataPoints: course?.snapshots.length ?? 0 };
    }

    const snaps = course.snapshots;
    const first = snaps[0]!;
    const last = snaps[snaps.length - 1]!;
    const totalChange = last.grade - first.grade;

    const firstDate = new Date(first.date).getTime();
    const lastDate = new Date(last.date).getTime();
    const weeks = Math.max((lastDate - firstDate) / (7 * 24 * 3600_000), 1);
    const velocity = totalChange / weeks;

    let direction: ITrend['direction'];
    if (Math.abs(totalChange) <= STABLE_THRESHOLD) {
      direction = 'stable';
    } else if (totalChange > 0) {
      direction = 'improving';
    } else {
      direction = 'declining';
    }

    return { direction, velocity: Math.round(velocity * 100) / 100, totalChange, dataPoints: snaps.length };
  }

  computeAllTrends(studentId: string): Record<string, ITrend> {
    const data = this.load(studentId);
    const result: Record<string, ITrend> = {};
    for (const courseName of Object.keys(data.courses)) {
      result[courseName] = this.computeTrend(studentId, courseName);
    }
    return result;
  }
}

import type { IReconciledGrade } from './grade-reconciler';
import type { ITrend } from './grade-history';
import type { ISlcDeltaOp } from './types';

const MAJOR_POINTS_THRESHOLD = 50;
const RISK_ORDER: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3 };
const COMPLETED_STATUSES = new Set(['graded', 'excused']);

export type RiskLevel = 'critical' | 'high' | 'moderate' | 'low';

export interface IRiskAssessment {
  readonly courseName: string;
  readonly officialGrade?: number;
  readonly riskLevel: RiskLevel;
  readonly trend: ITrend['direction'];
  readonly velocity: number;
  readonly reasons: readonly string[];
  readonly teacherName?: string;
  readonly teacherEmail?: string;
}

export interface IUpcomingDeadline {
  readonly title: string;
  readonly dueAt: string;
  readonly daysUntilDue: number;
  readonly pointsPossible?: number;
  readonly major: boolean;
  readonly status?: string;
  readonly courseExternalId: string;
}

export interface IStudentReport {
  readonly riskAssessments: readonly IRiskAssessment[];
  readonly upcomingDeadlines: readonly IUpcomingDeadline[];
  readonly atRiskCourses: readonly IRiskAssessment[];
  readonly missingAssignmentCount: number;
}

/**
 * Assess academic risk for each course based on grade + trend.
 * Returns courses sorted by risk level (critical first).
 */
export function assessRisk(
  grades: readonly IReconciledGrade[],
  trends: Readonly<Record<string, ITrend>>,
): IRiskAssessment[] {
  const assessments: IRiskAssessment[] = grades.map(g => {
    const trend = trends[g.courseName] ?? { direction: 'unknown' as const, velocity: 0, totalChange: 0, dataPoints: 0 };
    const grade = g.officialGrade;
    const reasons: string[] = [];

    let riskLevel: RiskLevel;

    if (grade == null) {
      riskLevel = 'moderate';
      reasons.push('No grade data available');
    } else if (grade < 70) {
      riskLevel = 'critical';
      reasons.push(`Grade ${grade}% is below passing (70%)`);
      if (trend.direction === 'declining') reasons.push(`Grade is declining (${trend.velocity} pts/week)`);
    } else if (grade < 75 && trend.direction === 'declining') {
      riskLevel = 'high';
      reasons.push(`Grade ${grade}% is near failing threshold`);
      reasons.push(`Declining trend (${trend.velocity} pts/week)`);
    } else if (grade < 75) {
      riskLevel = 'moderate';
      reasons.push(`Grade ${grade}% is close to passing threshold`);
    } else if (grade < 80) {
      riskLevel = 'moderate';
      reasons.push(`Grade ${grade}% — room for improvement`);
      if (trend.direction === 'declining') reasons.push('Declining trend');
    } else if (trend.direction === 'declining' && trend.velocity < -3) {
      riskLevel = 'moderate';
      reasons.push(`Rapidly declining (${trend.velocity} pts/week) despite ${grade}%`);
    } else {
      riskLevel = 'low';
      if (trend.direction === 'improving') reasons.push('Grade is improving');
    }

    return {
      courseName: g.courseName,
      officialGrade: grade,
      riskLevel,
      trend: trend.direction,
      velocity: trend.velocity,
      reasons,
      teacherName: g.teacherName,
      teacherEmail: g.teacherEmail,
    };
  });

  return assessments.sort((a, b) =>
    (RISK_ORDER[a.riskLevel] ?? 9) - (RISK_ORDER[b.riskLevel] ?? 9),
  );
}

/**
 * Extract upcoming assignment deadlines from ops within a day window.
 * Excludes already-completed assignments. Sorted by due date (soonest first).
 */
export function extractUpcomingDeadlines(
  ops: readonly ISlcDeltaOp[],
  windowDays: number = 14,
  now: Date = new Date(),
): IUpcomingDeadline[] {
  const windowEnd = new Date(now.getTime() + windowDays * 24 * 3600_000);
  const assignments = ops.filter(o => o.entity === 'assignment' && o.op === 'upsert');

  const deadlines: IUpcomingDeadline[] = [];
  for (const a of assignments) {
    const rec = a.record as Record<string, unknown> | undefined;
    if (!rec) continue;

    const dueAt = rec['dueAt'] as string | undefined;
    if (!dueAt) continue;

    const dueDate = new Date(dueAt);
    if (isNaN(dueDate.getTime()) || dueDate <= now || dueDate > windowEnd) continue;

    const status = (rec['status'] as string | undefined)?.toLowerCase();
    if (status && COMPLETED_STATUSES.has(status)) continue;

    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (24 * 3600_000));
    const points = rec['pointsPossible'] as number | undefined;

    deadlines.push({
      title: (rec['title'] as string) || 'Untitled',
      dueAt,
      daysUntilDue,
      pointsPossible: points,
      major: (points ?? 0) >= MAJOR_POINTS_THRESHOLD,
      status,
      courseExternalId: a.key.courseExternalId ?? '',
    });
  }

  return deadlines.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/**
 * Build a map of term externalId -> endDate (YYYY-MM-DD) from academicTerm ops.
 */
function getTermEndDatesFromOps(ops: readonly ISlcDeltaOp[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const o of ops) {
    if (o.entity !== 'academicTerm' || o.op !== 'upsert' || !o.record) continue;
    const rec = o.record as Record<string, unknown>;
    const externalId = (o.key as { externalId?: string }).externalId;
    const endDate = rec['endDate'] as string | undefined;
    if (externalId && endDate) map.set(externalId, endDate);
  }
  return map;
}

/**
 * True if the assignment's term has ended (so it should not count as "missing").
 */
function isMissingAssignmentInExpiredTerm(
  record: Record<string, unknown>,
  termEndDates: Map<string, string>,
  todayYMD: string,
): boolean {
  const termExternalId = record['termExternalId'] as string | undefined;
  if (!termExternalId) return false;
  const endDate = termEndDates.get(termExternalId);
  if (!endDate) return false;
  return endDate < todayYMD;
}

/**
 * Build a full student insight report from reconciled grades, trends, and current ops.
 * Missing assignments in expired terms (term.endDate < today) are excluded from the count.
 */
export function buildStudentReport(
  grades: readonly IReconciledGrade[],
  trends: Readonly<Record<string, ITrend>>,
  ops: readonly ISlcDeltaOp[],
  deadlineWindowDays?: number,
  now: Date = new Date(),
): IStudentReport {
  const riskAssessments = assessRisk(grades, trends);
  const upcomingDeadlines = extractUpcomingDeadlines(ops, deadlineWindowDays, now);
  const atRiskCourses = riskAssessments.filter(r => r.riskLevel === 'critical' || r.riskLevel === 'high');

  const termEndDates = getTermEndDatesFromOps(ops);
  const todayYMD = now.toISOString().slice(0, 10);

  const missingAssignmentCount = ops.filter((o) => {
    if (o.entity !== 'assignment' || (o.record as Record<string, unknown>)?.['status'] !== 'missing') return false;
    const rec = o.record as Record<string, unknown>;
    if (isMissingAssignmentInExpiredTerm(rec, termEndDates, todayYMD)) return false;
    return true;
  }).length;

  return { riskAssessments, upcomingDeadlines, atRiskCourses, missingAssignmentCount };
}

import type { ISlcDeltaOp } from './types';

const DISCREPANCY_THRESHOLD = 15;

function percentToLetter(percent: number): string {
  if (percent >= 90) return 'A';
  if (percent >= 80) return 'B';
  if (percent >= 70) return 'C';
  if (percent >= 60) return 'D';
  return 'F';
}

export interface ICourseMatch {
  readonly courseName: string;
  readonly sisCourseId?: string;
  readonly lmsCourseId?: string;
}

export interface IReconciledGrade {
  readonly courseName: string;
  readonly period?: string;
  readonly officialGrade?: number;
  readonly lmsGrade?: number;
  readonly letterGrade?: string;
  readonly source: 'sis' | 'lms';
  readonly delta?: number;
  readonly discrepancy: boolean;
  readonly teacherName?: string;
  readonly teacherEmail?: string;
  readonly sisCourseId?: string;
  readonly lmsCourseId?: string;
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formalNameFromCode(courseCode: string | undefined): string {
  if (!courseCode) return '';
  const parts = courseCode.split(' - ');
  return parts.length >= 2 ? parts[1]!.trim() : '';
}

export interface IMatchCoursesOptions {
  /** AI-generated map of raw title -> canonical title. Highest priority when present. */
  readonly canonicalMap?: Readonly<Record<string, string>>;
}

function resolveTitle(raw: string, canonicalMap?: Readonly<Record<string, string>>): string {
  if (canonicalMap) {
    const hit = canonicalMap[raw];
    if (hit) return normalize(hit);
  }
  return normalize(raw);
}

/**
 * Match courses across SIS and LMS providers by normalized name.
 * When canonicalMap is provided, AI-normalized titles take priority.
 * Falls back to rule-based normalization + courseCode formal name matching.
 */
export function matchCourses(
  sisOps: readonly ISlcDeltaOp[],
  lmsOps: readonly ISlcDeltaOp[],
  options?: IMatchCoursesOptions,
): ICourseMatch[] {
  const { canonicalMap } = options ?? {};
  const sisCourses = sisOps.filter(o => o.entity === 'course');
  const lmsCourses = lmsOps.filter(o => o.entity === 'course');
  const matches: ICourseMatch[] = [];
  const matchedLms = new Set<string>();

  for (const sis of sisCourses) {
    const sisRaw = (sis.record?.title as string) ?? '';
    const sisName = resolveTitle(sisRaw, canonicalMap);
    let bestMatch: ISlcDeltaOp | undefined;
    let bestScore = 0;

    for (const lms of lmsCourses) {
      if (matchedLms.has(lms.key.externalId)) continue;
      const lmsRaw = (lms.record?.title as string) ?? '';
      const lmsName = resolveTitle(lmsRaw, canonicalMap);
      const formal = formalNameFromCode(lms.record?.courseCode as string);
      const formalNorm = normalize(formal);

      let score = 0;
      // Canonical AI match (highest priority)
      if (sisName === lmsName && sisName.length > 0) score = 4;
      else if (formalNorm && sisName === formalNorm) score = 3;
      else if (formalNorm && (sisName.includes(formalNorm) || formalNorm.includes(sisName))) score = 2;
      else if (sisName.includes(lmsName) || lmsName.includes(sisName)) score = 1;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = lms;
      }
    }

    if (bestMatch) {
      matchedLms.add(bestMatch.key.externalId);
      matches.push({
        courseName: sisRaw || sisName,
        sisCourseId: sis.key.externalId,
        lmsCourseId: bestMatch.key.externalId,
      });
    } else {
      matches.push({
        courseName: sisRaw || sisName,
        sisCourseId: sis.key.externalId,
      });
    }
  }

  for (const lms of lmsCourses) {
    if (matchedLms.has(lms.key.externalId)) continue;
    const formal = formalNameFromCode(lms.record?.courseCode as string);
    matches.push({
      courseName: formal || ((lms.record?.title as string) ?? ''),
      lmsCourseId: lms.key.externalId,
    });
  }

  return matches;
}

/**
 * Reconcile grades from SIS and LMS sources.
 * SIS is authoritative (grade of record). LMS provides enrichment.
 * Flags discrepancies > 15 percentage points.
 */
export function reconcileGrades(
  sisOps: readonly ISlcDeltaOp[],
  lmsOps: readonly ISlcDeltaOp[],
  options?: IMatchCoursesOptions,
): IReconciledGrade[] {
  const matches = matchCourses(sisOps, lmsOps, options);
  const sisGrades = sisOps.filter(o => o.entity === 'gradeSnapshot');
  const lmsGrades = lmsOps.filter(o => o.entity === 'gradeSnapshot');
  const sisCourses = sisOps.filter(o => o.entity === 'course');
  const lmsCourses = lmsOps.filter(o => o.entity === 'course');

  return matches.map(m => {
    const sisGrade = m.sisCourseId
      ? sisGrades.find(g => g.key.courseExternalId === m.sisCourseId)
      : undefined;
    const lmsGrade = m.lmsCourseId
      ? lmsGrades.find(g => g.key.courseExternalId === m.lmsCourseId)
      : undefined;

    const sisCourse = m.sisCourseId
      ? sisCourses.find(c => c.key.externalId === m.sisCourseId)
      : undefined;
    const lmsCourse = m.lmsCourseId
      ? lmsCourses.find(c => c.key.externalId === m.lmsCourseId)
      : undefined;

    const sisPct = sisGrade?.record?.percentGrade as number | undefined;
    const lmsPct = lmsGrade?.record?.percentGrade as number | undefined;
    const officialGrade = sisPct ?? lmsPct;
    const source: 'sis' | 'lms' = sisPct != null ? 'sis' : 'lms';

    const delta = (sisPct != null && lmsPct != null) ? lmsPct - sisPct : undefined;
    const discrepancy = delta != null && Math.abs(delta) > DISCREPANCY_THRESHOLD;

    const sisTeacher = sisCourse?.record?.teacherName as string | undefined;
    const lmsTeacher = lmsCourse?.record?.teacherName as string | undefined;
    const lmsEmail = lmsCourse?.record?.teacherEmail as string | undefined;

    // Prioritize stored letter grade, but compute from percent if not available
    const storedLetter = (sisGrade?.record?.letterGrade ?? lmsGrade?.record?.letterGrade) as string | undefined;
    const letterGrade = storedLetter ?? (officialGrade != null ? percentToLetter(officialGrade) : undefined);

    return {
      courseName: m.courseName,
      period: (sisCourse?.record?.period ?? lmsCourse?.record?.period) as string | undefined,
      officialGrade,
      lmsGrade: lmsPct,
      letterGrade,
      source,
      delta,
      discrepancy,
      teacherName: sisTeacher || lmsTeacher,
      teacherEmail: lmsEmail,
      sisCourseId: m.sisCourseId,
      lmsCourseId: m.lmsCourseId,
    };
  });
}

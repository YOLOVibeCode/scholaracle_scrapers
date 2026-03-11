/**
 * Pure helpers for resolving studentExternalId and sourceId in run flows.
 * Used by run.ts; tested in run-ids.test.ts.
 */

import type { IStudentProfile, IScraperProfile } from '../core/config';

export interface IResolvedProfileIds {
  readonly studentExternalId: string;
  readonly sourceId: string;
}

/**
 * Resolve studentExternalId and sourceId for a profile-based run (one student).
 */
export function resolveProfileRunIds(
  student: IStudentProfile | undefined,
  studentId: string,
  profile: IScraperProfile,
  platform: string
): IResolvedProfileIds {
  const studentName = student?.name ?? studentId;
  const studentExternalId = student?.externalId ?? studentId;
  const matchingDs = student?.dataSources?.find(ds => ds.provider === platform);
  const sourceId = profile.sourceId ?? matchingDs?.sourceId ?? `${platform}-${studentExternalId}`;
  return { studentExternalId, sourceId };
}

/**
 * Resolve studentExternalId and sourceId for a manual run (no profile).
 */
export function resolveManualRunIds(
  studentName: string,
  students: readonly IStudentProfile[] | undefined,
  platform: string
): IResolvedProfileIds {
  const nameNorm = (studentName ?? '').trim();
  const cached = students?.find(
    s => s.name.toLowerCase().trim() === nameNorm.toLowerCase()
  );
  const studentExternalId = cached?.externalId ?? nameNorm.toLowerCase().replace(/\s+/g, '-');
  const matchingDs = cached?.dataSources?.find(ds => ds.provider === platform);
  const sourceId = matchingDs?.sourceId ?? `${platform}-${studentExternalId}`;
  return { studentExternalId, sourceId };
}

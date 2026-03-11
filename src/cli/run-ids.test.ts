import { resolveProfileRunIds, resolveManualRunIds } from './run-ids';
import type { IStudentProfile, IScraperProfile } from '../core/config';

function makeStudent(overrides: Partial<IStudentProfile> = {}): IStudentProfile {
  return {
    id: 'stu-1',
    name: 'Emma Lewis',
    externalId: 'server-id-emma',
    ...overrides,
  };
}

function makeProfile(overrides: Partial<IScraperProfile> = {}): IScraperProfile {
  return {
    id: 'profile-1',
    platform: 'canvas',
    label: "Emma's Canvas",
    credentialsId: 'creds-1',
    studentIds: ['stu-1'],
    dataTypes: ['grades'],
    createdAt: '2026-02-19T12:00:00Z',
    ...overrides,
  };
}

describe('resolveProfileRunIds', () => {
  it('should use profile.sourceId and student.externalId when present', () => {
    const student = makeStudent({ externalId: 'server-id-emma' });
    const profile = makeProfile({ sourceId: 'profile-source-id-from-server' });
    const result = resolveProfileRunIds(student, 'stu-1', profile, 'canvas');
    expect(result.sourceId).toBe('profile-source-id-from-server');
    expect(result.studentExternalId).toBe('server-id-emma');
  });

  it('should use student dataSources sourceId when profile has no sourceId', () => {
    const student = makeStudent({
      externalId: 'server-id-emma',
      dataSources: [
        { sourceId: 'student-ds-source-id', provider: 'canvas', displayName: 'Canvas LMS' },
      ],
    });
    const profile = makeProfile({}); // no sourceId
    const result = resolveProfileRunIds(student, 'stu-1', profile, 'canvas');
    expect(result.sourceId).toBe('student-ds-source-id');
    expect(result.studentExternalId).toBe('server-id-emma');
  });

  it('should fall back to fabricated sourceId when no profile or student source', () => {
    const student = makeStudent({ externalId: 'server-id-emma' });
    const profile = makeProfile({}); // no sourceId
    const result = resolveProfileRunIds(student, 'stu-1', profile, 'canvas');
    expect(result.sourceId).toBe('canvas-server-id-emma');
    expect(result.studentExternalId).toBe('server-id-emma');
  });

  it('should use studentId when student not in cache', () => {
    const result = resolveProfileRunIds(undefined, 'stu-1', makeProfile(), 'canvas');
    expect(result.studentExternalId).toBe('stu-1');
    expect(result.sourceId).toBe('canvas-stu-1');
  });
});

describe('resolveManualRunIds', () => {
  it('should resolve studentExternalId from cached students by name match', () => {
    const students: IStudentProfile[] = [
      makeStudent({ name: 'Emma Lewis', externalId: 'server-id-emma' }),
    ];
    const result = resolveManualRunIds('Emma Lewis', students, 'canvas');
    expect(result.studentExternalId).toBe('server-id-emma');
  });

  it('should use student dataSources sourceId when matching by name', () => {
    const students: IStudentProfile[] = [
      makeStudent({
        name: 'Emma Lewis',
        externalId: 'server-id-emma',
        dataSources: [
          { sourceId: 'manual-ds-id', provider: 'canvas', displayName: 'Canvas' },
        ],
      }),
    ];
    const result = resolveManualRunIds('Emma Lewis', students, 'canvas');
    expect(result.sourceId).toBe('manual-ds-id');
    expect(result.studentExternalId).toBe('server-id-emma');
  });

  it('should fall back to slug when name not in cache', () => {
    const result = resolveManualRunIds('Emma Lewis', [], 'canvas');
    expect(result.studentExternalId).toBe('emma-lewis');
    expect(result.sourceId).toBe('canvas-emma-lewis');
  });

  it('should handle empty student name', () => {
    const result = resolveManualRunIds('', [], 'aeries');
    expect(result.studentExternalId).toBe('');
    expect(result.sourceId).toBe('aeries-');
  });
});

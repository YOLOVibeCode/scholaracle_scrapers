import { ScraperConfig, type IStoredCredentials, type IScraperProfile, type IStudentProfile } from './config';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fetchStudents as fetchStudentsFromApi } from './api-client';

jest.mock('./api-client', () => ({ fetchStudents: jest.fn().mockResolvedValue([]) }));

const TEST_DIR = join(tmpdir(), 'scholaracle-scraper-test-' + Date.now());

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('ScraperConfig', () => {
  it('should create a new config with defaults', () => {
    const cfg = new ScraperConfig(TEST_DIR);
    const data = cfg.load();
    expect(data.apiBaseUrl).toBe('https://api.scholarmancy.com');
    expect(data.connectorToken).toBeUndefined();
    expect(data.aiProvider).toBeUndefined();
  });

  it('should save and reload config', () => {
    const cfg = new ScraperConfig(TEST_DIR);
    cfg.save({
      apiBaseUrl: 'https://api.scholarmancy.com',
      connectorToken: 'tok-123',
      aiProvider: 'openai',
      aiApiKey: 'sk-test',
    });

    const loaded = cfg.load();
    expect(loaded.connectorToken).toBe('tok-123');
    expect(loaded.aiProvider).toBe('openai');
    expect(loaded.aiApiKey).toBe('sk-test');
  });

  it('should update individual fields without losing others', () => {
    const cfg = new ScraperConfig(TEST_DIR);
    cfg.save({
      apiBaseUrl: 'https://api.scholarmancy.com',
      connectorToken: 'tok-123',
    });

    cfg.update({ aiProvider: 'anthropic' });

    const loaded = cfg.load();
    expect(loaded.connectorToken).toBe('tok-123');
    expect(loaded.aiProvider).toBe('anthropic');
  });

  it('should create config directory if it does not exist', () => {
    const newDir = join(TEST_DIR, 'nested', 'dir');
    const cfg = new ScraperConfig(newDir);
    cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com' });
    expect(existsSync(join(newDir, 'config.json'))).toBe(true);
  });

  it('should report token expiry status', () => {
    const cfg = new ScraperConfig(TEST_DIR);

    // No token
    expect(cfg.getTokenStatus()).toEqual({ status: 'missing' });

    // Valid JWT (not expired) — we create a fake one with exp far in future
    const futureExp = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    const fakeJwtPayload = Buffer.from(JSON.stringify({ exp: futureExp, userId: 'u1' })).toString('base64url');
    const fakeJwt = `eyJhbGciOiJIUzI1NiJ9.${fakeJwtPayload}.fakesig`;

    cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com', connectorToken: fakeJwt });
    const status = cfg.getTokenStatus();
    expect(status.status).toBe('active');
    expect(status.daysRemaining).toBeGreaterThan(300);
  });

  it('should detect expiring-soon token', () => {
    const cfg = new ScraperConfig(TEST_DIR);

    const soonExp = Math.floor(Date.now() / 1000) + 5 * 24 * 3600; // 5 days
    const fakeJwtPayload = Buffer.from(JSON.stringify({ exp: soonExp })).toString('base64url');
    const fakeJwt = `eyJhbGciOiJIUzI1NiJ9.${fakeJwtPayload}.fakesig`;

    cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com', connectorToken: fakeJwt });
    const status = cfg.getTokenStatus();
    expect(status.status).toBe('expiring');
    expect(status.daysRemaining).toBeLessThanOrEqual(7);
  });

  it('should detect expired token', () => {
    const cfg = new ScraperConfig(TEST_DIR);

    const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const fakeJwtPayload = Buffer.from(JSON.stringify({ exp: pastExp })).toString('base64url');
    const fakeJwt = `eyJhbGciOiJIUzI1NiJ9.${fakeJwtPayload}.fakesig`;

    cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com', connectorToken: fakeJwt });
    const status = cfg.getTokenStatus();
    expect(status.status).toBe('expired');
  });

  it('should manage scraper configurations', () => {
    const cfg = new ScraperConfig(TEST_DIR);
    cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com', scrapers: {} });

    cfg.setScraper('canvas', {
      student: 'emma-001',
      credentialsRef: 'canvas-emma',
    });

    const loaded = cfg.load();
    expect(loaded.scrapers?.['canvas']).toEqual({
      student: 'emma-001',
      credentialsRef: 'canvas-emma',
    });
  });

  it('should manage schedule configurations', () => {
    const cfg = new ScraperConfig(TEST_DIR);
    cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com', schedules: [] });

    cfg.addSchedule({
      scraper: 'canvas',
      time: '06:30',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      timezone: 'America/Chicago',
      enabled: true,
    });

    const loaded = cfg.load();
    expect(loaded.schedules).toHaveLength(1);
    expect(loaded.schedules![0].scraper).toBe('canvas');
    expect(loaded.schedules![0].time).toBe('06:30');
  });

  describe('credentials (separate file)', () => {
    it('should add credentials and store in credentials.json only', () => {
      const subDir = join(TEST_DIR, 'creds-isolation');
      mkdirSync(subDir, { recursive: true });
      const cfg = new ScraperConfig(subDir);
      cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com' });

      const creds: IStoredCredentials = {
        id: 'creds-uuid-1',
        label: 'Lincoln High Canvas',
        baseUrl: 'https://lincoln.instructure.com',
        loginMethod: 'email_password',
        username: 'parent@example.com',
        password: 'secret',
      };
      cfg.addCredentials(creds);

      const configRaw = readFileSync(join(subDir, 'config.json'), 'utf-8');
      expect(configRaw).not.toContain('secret');
      expect(configRaw).not.toContain('password');

      const credsPath = join(subDir, 'credentials.json');
      expect(existsSync(credsPath)).toBe(true);
      const credsData = JSON.parse(readFileSync(credsPath, 'utf-8'));
      expect(credsData.credentials).toHaveLength(1);
      expect(credsData.credentials[0].password).toBe('secret');
    });

    it('should return all credentials via getCredentials()', () => {
      const subDir = join(TEST_DIR, 'creds-getAll');
      mkdirSync(subDir, { recursive: true });
      const cfg = new ScraperConfig(subDir);
      cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com' });

      cfg.addCredentials({
        id: 'c1',
        label: 'Portal A',
        baseUrl: 'https://a.example.com',
        loginMethod: 'email_password',
        username: 'u1',
        password: 'p1',
      });
      cfg.addCredentials({
        id: 'c2',
        label: 'Portal B',
        baseUrl: 'https://b.example.com',
        loginMethod: 'google_sso',
        username: '',
        password: '',
      });

      const all = cfg.getCredentials();
      expect(all).toHaveLength(2);
      expect(all.map((c: IStoredCredentials) => c.id)).toEqual(['c1', 'c2']);
      expect(all.map((c: IStoredCredentials) => c.label)).toEqual(['Portal A', 'Portal B']);
    });

    it('should return single credential via getCredentialsById()', () => {
      const subDir = join(TEST_DIR, 'creds-getById');
      mkdirSync(subDir, { recursive: true });
      const cfg = new ScraperConfig(subDir);
      cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com' });
      cfg.addCredentials({
        id: 'creds-xyz',
        label: 'My Portal',
        baseUrl: 'https://portal.edu',
        loginMethod: 'email_password',
        username: 'user',
        password: 'pass',
      });

      const found = cfg.getCredentialsById('creds-xyz');
      expect(found).toBeDefined();
      expect(found!.label).toBe('My Portal');
      expect(found!.username).toBe('user');

      expect(cfg.getCredentialsById('nonexistent')).toBeUndefined();
    });
  });

  describe('scraper profiles', () => {
    it('should add scraper profile and list via getScraperProfiles()', () => {
      const subDir = join(TEST_DIR, 'profiles-add');
      mkdirSync(subDir, { recursive: true });
      const cfg = new ScraperConfig(subDir);
      cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com', scraperProfiles: [] });

      const profile: IScraperProfile = {
        id: 'profile-1',
        platform: 'powerschool',
        label: "Emma's PowerSchool",
        credentialsId: 'creds-1',
        studentIds: ['stu-emma'],
        dataTypes: ['grades', 'assignments'],
        createdAt: '2026-02-19T12:00:00Z',
      };
      cfg.addScraperProfile(profile);

      const profiles = cfg.getScraperProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].platform).toBe('powerschool');
      expect(profiles[0].studentIds).toEqual(['stu-emma']);
    });

    it('should return profiles for a given student via getScrapersForStudent()', () => {
      const subDir = join(TEST_DIR, 'profiles-forStudent');
      mkdirSync(subDir, { recursive: true });
      const cfg = new ScraperConfig(subDir);
      cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com', scraperProfiles: [] });

      cfg.addScraperProfile({
        id: 'p1',
        platform: 'canvas',
        label: "Emma's Canvas",
        credentialsId: 'c1',
        studentIds: ['stu-emma'],
        dataTypes: ['grades'],
        createdAt: '2026-02-19T12:00:00Z',
      });
      cfg.addScraperProfile({
        id: 'p2',
        platform: 'aeries',
        label: "Emma's Aeries",
        credentialsId: 'c2',
        studentIds: ['stu-emma'],
        dataTypes: ['grades'],
        createdAt: '2026-02-19T12:00:00Z',
      });
      cfg.addScraperProfile({
        id: 'p3',
        platform: 'canvas',
        label: "Jack's Canvas",
        credentialsId: 'c3',
        studentIds: ['stu-jack'],
        dataTypes: ['grades'],
        createdAt: '2026-02-19T12:00:00Z',
      });

      const emmaProfiles = cfg.getScrapersForStudent('stu-emma');
      expect(emmaProfiles).toHaveLength(2);
      expect(emmaProfiles.map((p: IScraperProfile) => p.id).sort()).toEqual(['p1', 'p2']);

      const jackProfiles = cfg.getScrapersForStudent('stu-jack');
      expect(jackProfiles).toHaveLength(1);
      expect(jackProfiles[0].platform).toBe('canvas');

      expect(cfg.getScrapersForStudent('stu-unknown')).toHaveLength(0);
    });

    it('should accept and return profile with optional sourceId', () => {
      const subDir = join(TEST_DIR, 'profiles-sourceId');
      mkdirSync(subDir, { recursive: true });
      const cfg = new ScraperConfig(subDir);
      cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com', scraperProfiles: [] });

      cfg.addScraperProfile({
        id: 'p-src',
        platform: 'canvas',
        label: "Emma's Canvas",
        credentialsId: 'c1',
        sourceId: 'src-uuid-from-server',
        studentIds: ['stu-emma'],
        dataTypes: ['grades'],
        createdAt: '2026-02-19T12:00:00Z',
      });

      const profiles = cfg.getScraperProfiles();
      expect(profiles[0].sourceId).toBe('src-uuid-from-server');
    });
  });

  describe('fetchStudents', () => {
    it('should store students with grade and dataSources when API returns them', async () => {
      const subDir = join(TEST_DIR, 'fetchStudents');
      mkdirSync(subDir, { recursive: true });
      const cfg = new ScraperConfig(subDir);
      cfg.save({ apiBaseUrl: 'https://api.example.com', connectorToken: 'tok' });

      (fetchStudentsFromApi as jest.Mock).mockResolvedValueOnce([
        {
          id: 'abc123',
          name: 'Emma Lewis',
          externalId: 'abc123',
          grade: 7,
          dataSources: [
            { sourceId: 'src-1', provider: 'canvas', displayName: 'Canvas LMS', portalBaseUrl: 'https://lincoln.instructure.com' },
          ],
        },
      ]);

      const result = await cfg.fetchStudents('https://api.example.com', 'tok');

      expect(result).toHaveLength(1);
      const stu = result[0] as IStudentProfile;
      expect(stu.grade).toBe(7);
      expect(stu.dataSources).toHaveLength(1);
      expect(stu.dataSources?.[0].sourceId).toBe('src-1');
      expect(stu.dataSources?.[0].provider).toBe('canvas');

      const loaded = cfg.load();
      expect(loaded.students).toHaveLength(1);
      expect(loaded.students![0].grade).toBe(7);
      expect(loaded.students![0].dataSources?.[0].sourceId).toBe('src-1');
    });
  });
});

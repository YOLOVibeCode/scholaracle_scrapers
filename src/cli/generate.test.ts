import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateCommand } from './generate';
import { ScraperConfig } from '../core/config';

const TEST_DIR = join(tmpdir(), 'scholaracle-generate-test-' + Date.now());
const SCRAPERS_ROOT = join(TEST_DIR, 'src', 'scrapers');

const FAKE_AI_RESPONSE = `--- metadata.json ---
{"id":"test-browser","name":"Test Platform","version":"1.0.0"}
--- powerschool-transformer.ts ---
export function transform() { return []; }
--- powerschool-scraper.ts ---
export class TestScraper {}
`;

let mockPrompt: jest.Mock;
let aiGenerate: jest.Mock;

jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
}));

jest.mock('../ai/client', () => ({
  AiClient: jest.fn().mockImplementation(() => ({
    generate: (...args: unknown[]) => aiGenerate(...args),
  })),
}));

const mockRegisterSource = jest.fn().mockResolvedValue(undefined);
jest.mock('../core/api-client', () => ({
  fetchStudents: jest.fn().mockResolvedValue([
    { id: 'stu-emma', name: 'Emma Lewis', externalId: 'emma-lewis' },
    { id: 'stu-jack', name: 'Jack Smith', externalId: 'jack-smith' },
  ]),
  registerSource: (...args: unknown[]) => mockRegisterSource(...args),
}));

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  const inquirer = require('inquirer');
  mockPrompt = inquirer.default.prompt as jest.Mock;
  mockPrompt.mockReset();
  mockRegisterSource.mockClear();
  aiGenerate = jest.fn().mockResolvedValue(FAKE_AI_RESPONSE);
  rmSync(SCRAPERS_ROOT, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, 'src', 'scrapers'), { recursive: true });
});

function setupPrerequisitesConfig(): void {
  const futureExp = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const fakeJwt = `eyJ.${Buffer.from(JSON.stringify({ exp: futureExp })).toString('base64url')}.sig`;
  const cfg = new ScraperConfig(TEST_DIR);
  cfg.save({
    apiBaseUrl: 'https://api.scholarmancy.com',
    connectorToken: fakeJwt,
    aiProvider: 'openai',
    aiApiKey: 'sk-test',
  });
}

describe('generateCommand', () => {
  it('should exit early when connector token is missing', async () => {
    const cfg = new ScraperConfig(TEST_DIR);
    cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com' });

    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    await generateCommand({ configDir: TEST_DIR });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('setup'));
    expect(mockPrompt).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('should exit early when AI provider is not configured', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    const fakeJwt = `eyJ.${Buffer.from(JSON.stringify({ exp: futureExp })).toString('base64url')}.sig`;
    const cfg = new ScraperConfig(TEST_DIR);
    cfg.save({ apiBaseUrl: 'https://api.scholarmancy.com', connectorToken: fakeJwt });

    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    await generateCommand({ configDir: TEST_DIR });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('AI'));
    expect(mockPrompt).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('should fetch students, run wizard, generate files, and save scraper profile', async () => {
    setupPrerequisitesConfig();

    mockPrompt
      .mockResolvedValueOnce({ studentIds: ['stu-emma'] })
      .mockResolvedValueOnce({
        platformName: 'PowerSchool',
        loginUrl: 'https://ps.school.edu',
        loginMethod: 'email_password',
      })
      .mockResolvedValueOnce({
        username: 'parent@school.edu',
        password: 'secret',
        credentialsLabel: 'My PowerSchool',
      })
      .mockResolvedValueOnce({
        dataTypes: ['grades', 'assignments'],
        notes: '',
      })
      .mockResolvedValueOnce({ runNow: false });

    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    await generateCommand({ configDir: TEST_DIR });

    expect(aiGenerate).toHaveBeenCalled();
    const writtenDir = join(SCRAPERS_ROOT, 'powerschool');
    expect(existsSync(join(writtenDir, 'metadata.json'))).toBe(true);
    expect(existsSync(join(writtenDir, 'powerschool-transformer.ts'))).toBe(true);
    expect(existsSync(join(writtenDir, 'powerschool-scraper.ts'))).toBe(true);

    const cfg = new ScraperConfig(TEST_DIR);
    const profiles = cfg.getScraperProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].platform).toBe('powerschool');
    expect(profiles[0].studentIds).toContain('stu-emma');
    expect(profiles[0].credentialsId).toBeDefined();
    expect(profiles[0].sourceId).toBeDefined();
    expect(mockRegisterSource).toHaveBeenCalledWith(
      'https://api.scholarmancy.com',
      expect.any(String),
      expect.objectContaining({
        provider: 'powerschool',
        adapterId: 'test-browser',
        displayName: 'Test Platform',
        portalBaseUrl: 'https://ps.school.edu',
      })
    );

    const creds = cfg.getCredentialsById(profiles[0].credentialsId);
    expect(creds).toBeDefined();
    expect(creds!.label).toBe('My PowerSchool');
    expect(creds!.username).toBe('parent@school.edu');

    logSpy.mockRestore();
  });

  it('should support multi-student selection', async () => {
    setupPrerequisitesConfig();

    mockPrompt
      .mockResolvedValueOnce({ studentIds: ['stu-emma', 'stu-jack'] })
      .mockResolvedValueOnce({
        platformName: 'Infinite Campus',
        loginUrl: 'https://campus.school.edu',
        loginMethod: 'google_sso',
      })
      .mockResolvedValueOnce({
        username: '',
        password: '',
        credentialsLabel: 'Campus SSO',
      })
      .mockResolvedValueOnce({ dataTypes: ['grades'], notes: '' })
      .mockResolvedValueOnce({ runNow: false });

    jest.spyOn(console, 'log').mockImplementation();

    await generateCommand({ configDir: TEST_DIR });

    const cfg = new ScraperConfig(TEST_DIR);
    const profiles = cfg.getScraperProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].studentIds).toEqual(expect.arrayContaining(['stu-emma', 'stu-jack']));
  });
});

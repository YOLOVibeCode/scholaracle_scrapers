import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fetchStudents as fetchStudentsFromApi } from './api-client';

// ---------------------------------------------------------------------------
// Config data types
// ---------------------------------------------------------------------------

export interface IScraperSchedule {
  readonly scraper: string;
  readonly time: string;
  readonly days: readonly string[];
  readonly timezone: string;
  readonly enabled: boolean;
}

export interface IScraperRef {
  readonly student: string;
  readonly credentialsRef: string;
}

export interface IStudentDataSource {
  readonly sourceId: string;
  readonly provider: string;
  readonly displayName: string;
  readonly portalBaseUrl?: string;
}

export interface IStudentProfile {
  readonly id: string;
  readonly name: string;
  readonly externalId: string;
  readonly grade?: number;
  readonly dataSources?: readonly IStudentDataSource[];
}

export interface IScraperProfile {
  readonly id: string;
  readonly platform: string;
  readonly label: string;
  readonly credentialsId: string;
  readonly sourceId?: string;
  readonly studentIds: readonly string[];
  readonly dataTypes: readonly string[];
  readonly createdAt: string;
}

export interface IStoredCredentials {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly loginMethod: string;
  readonly username: string;
  readonly password: string;
}

export interface IConfigData {
  apiBaseUrl: string;
  connectorToken?: string;
  aiProvider?: 'openai' | 'anthropic' | 'gemini';
  aiApiKey?: string;
  students?: IStudentProfile[];
  scrapers?: Record<string, IScraperRef>;
  schedules?: IScraperSchedule[];
  scraperProfiles?: IScraperProfile[];
}

export interface ITokenStatus {
  status: 'active' | 'expiring' | 'expired' | 'missing';
  daysRemaining?: number;
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// Config manager
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG_DIR = join(homedir(), '.scholaracle-scraper');
const CONFIG_FILENAME = 'config.json';
const CREDENTIALS_FILENAME = 'credentials.json';
const DEFAULT_API_URL = 'https://api.scholarmancy.com';

interface ICredentialsFile {
  credentials: IStoredCredentials[];
}

export class ScraperConfig {
  private readonly configDir: string;
  private readonly configPath: string;
  private readonly credentialsPath: string;

  constructor(configDir?: string) {
    this.configDir = configDir ?? DEFAULT_CONFIG_DIR;
    this.configPath = join(this.configDir, CONFIG_FILENAME);
    this.credentialsPath = join(this.configDir, CREDENTIALS_FILENAME);
  }

  getConfigDir(): string {
    return this.configDir;
  }

  load(): IConfigData {
    if (!existsSync(this.configPath)) {
      return { apiBaseUrl: DEFAULT_API_URL };
    }
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(raw) as IConfigData;
    } catch {
      return { apiBaseUrl: DEFAULT_API_URL };
    }
  }

  save(data: IConfigData): void {
    mkdirSync(this.configDir, { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  update(partial: Partial<IConfigData>): void {
    const current = this.load();
    this.save({ ...current, ...partial });
  }

  /**
   * Decode the connector token's exp claim and return status.
   * Does NOT verify the signature — that's the server's job.
   */
  getTokenStatus(): ITokenStatus {
    const data = this.load();
    if (!data.connectorToken) {
      return { status: 'missing' };
    }

    try {
      const parts = data.connectorToken.split('.');
      if (parts.length !== 3) return { status: 'missing' };

      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8'));
      const exp = payload.exp as number | undefined;
      if (!exp) return { status: 'active' };

      const nowSec = Math.floor(Date.now() / 1000);
      const remainingSec = exp - nowSec;

      if (remainingSec <= 0) {
        return { status: 'expired', expiresAt: new Date(exp * 1000).toISOString() };
      }

      const daysRemaining = Math.floor(remainingSec / (24 * 3600));
      if (daysRemaining <= 7) {
        return { status: 'expiring', daysRemaining, expiresAt: new Date(exp * 1000).toISOString() };
      }

      return { status: 'active', daysRemaining, expiresAt: new Date(exp * 1000).toISOString() };
    } catch {
      return { status: 'missing' };
    }
  }

  setScraper(id: string, ref: IScraperRef): void {
    const data = this.load();
    const scrapers = data.scrapers ?? {};
    scrapers[id] = ref;
    this.save({ ...data, scrapers });
  }

  addSchedule(schedule: IScraperSchedule): void {
    const data = this.load();
    const schedules = data.schedules ?? [];
    schedules.push(schedule);
    this.save({ ...data, schedules });
  }

  private loadCredentialsFile(): ICredentialsFile {
    if (!existsSync(this.credentialsPath)) {
      return { credentials: [] };
    }
    try {
      const raw = readFileSync(this.credentialsPath, 'utf-8');
      return JSON.parse(raw) as ICredentialsFile;
    } catch {
      return { credentials: [] };
    }
  }

  private saveCredentialsFile(file: ICredentialsFile): void {
    mkdirSync(this.configDir, { recursive: true });
    writeFileSync(this.credentialsPath, JSON.stringify(file, null, 2), 'utf-8');
  }

  addCredentials(creds: IStoredCredentials): void {
    const file = this.loadCredentialsFile();
    const existing = file.credentials.findIndex(c => c.id === creds.id);
    const next = existing >= 0
      ? file.credentials.map((c, i) => (i === existing ? creds : c))
      : [...file.credentials, creds];
    this.saveCredentialsFile({ credentials: next });
  }

  getCredentials(): IStoredCredentials[] {
    return this.loadCredentialsFile().credentials;
  }

  getCredentialsById(id: string): IStoredCredentials | undefined {
    return this.loadCredentialsFile().credentials.find(c => c.id === id);
  }

  addScraperProfile(profile: IScraperProfile): void {
    const data = this.load();
    const profiles = data.scraperProfiles ?? [];
    profiles.push(profile);
    this.save({ ...data, scraperProfiles: profiles });
  }

  getScraperProfiles(): IScraperProfile[] {
    const data = this.load();
    return data.scraperProfiles ?? [];
  }

  getScrapersForStudent(studentId: string): IScraperProfile[] {
    return this.getScraperProfiles().filter(p => p.studentIds.includes(studentId));
  }

  /**
   * Fetches students from the Scholaracle API and caches them in config.
   * Throws on API or network errors.
   */
  async fetchStudents(apiBaseUrl: string, connectorToken: string): Promise<IStudentProfile[]> {
    const list = await fetchStudentsFromApi(apiBaseUrl, connectorToken);
    const students: IStudentProfile[] = list.map(s => ({
      id: s.id,
      name: s.name,
      externalId: s.externalId,
      ...(s.grade !== undefined && { grade: s.grade }),
      ...(s.dataSources !== undefined && { dataSources: s.dataSources }),
    }));
    this.update({ students });
    return students;
  }
}

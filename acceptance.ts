/**
 * Acceptance runner — runs each kid × portal profile live against the real
 * school portal, captures fixtures, and judges the result against the
 * recorded standard.
 *
 * Usage:
 *   npm run acceptance                     # all profiles in ~/.scholaracle-scraper/config.json
 *   npm run acceptance -- skyward-ava      # one profile by id (or platform name)
 *   npm run acceptance -- --record         # (re)record the standard from this run
 *   npm run acceptance -- --upload         # also upload validated envelopes
 *   npm run acceptance -- --headless       # no visible browser (fails on SSO/MFA portals)
 *
 * Outputs:
 *   fixtures/<sourceId>/{raw,envelope,meta}.json   — real data, gitignored
 *   acceptance/<sourceId>.json                     — counts-only standard, committed
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ScraperConfig, type IScraperProfile, type IStoredCredentials } from './src/core/config';
import { validateEnvelope } from '@scholaracle/scraper-core';
import { ScholaracleUploader } from './src/core/uploader';
import {
  countEntities,
  draftExpectations,
  evaluateAcceptance,
  loadExpectations,
  saveExpectations,
  saveFixture,
} from './src/core/acceptance';
import type { BaseScraper } from './src/core/base-scraper';
import type { IScraperConfig, IScraperCredentials, IScraperProgress } from './src/core/scraper-types';
import { CanvasScraper } from './src/scrapers/canvas/canvas-scraper';
import { SkywardScraper } from './src/scrapers/skyward/skyward-scraper';
import { AeriesScraper } from './src/scrapers/aeries/aeries-scraper';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const EXPECTATIONS_DIR = join(__dirname, 'acceptance');

const SCRAPERS: Record<string, new () => BaseScraper> = {
  canvas: CanvasScraper,
  skyward: SkywardScraper,
  aeries: AeriesScraper,
};

const PHASE_ICONS: Record<string, string> = {
  initializing: '🔧',
  authenticating: '🔑',
  discovering_students: '👥',
  switching_student: '👤',
  scraping: '📡',
  transforming: '⚙️',
  processing_assets: '📦',
  validating: '✅',
  uploading: '☁️',
  cleanup: '🧹',
  completed: '🎉',
  failed: '❌',
};

function onProgress(p: IScraperProgress): void {
  const icon = PHASE_ICONS[p.phase] ?? '•';
  const dur = p.durationMs ? ` (${(p.durationMs / 1000).toFixed(1)}s)` : '';
  console.log(`    ${icon} ${p.phase.padEnd(20)} ${p.message}${dur}`);
}

interface IRunnerArgs {
  readonly profileFilters: readonly string[];
  readonly isRecord: boolean;
  readonly isUpload: boolean;
  readonly isHeadless: boolean;
}

function parseArgs(argv: readonly string[]): IRunnerArgs {
  const flags = argv.filter(a => a.startsWith('--'));
  return {
    profileFilters: argv.filter(a => !a.startsWith('--')),
    isRecord: flags.includes('--record'),
    isUpload: flags.includes('--upload'),
    isHeadless: flags.includes('--headless'),
  };
}

function buildScraperConfig(
  profile: IScraperProfile,
  creds: IStoredCredentials,
  configMgr: ScraperConfig,
  isHeadless: boolean,
): IScraperConfig {
  const configData = configMgr.load();
  const studentId = profile.studentIds[0];
  const student = (configData.students ?? []).find(s => s.id === studentId);
  if (!student) throw new Error(`Profile "${profile.id}" references unknown student "${studentId}"`);

  const sourceId =
    profile.sourceId ??
    student.dataSources?.find(d => d.provider === profile.platform)?.sourceId ??
    `${profile.platform}-${student.externalId}`;

  const credentials: IScraperCredentials = {
    baseUrl: creds.baseUrl,
    username: creds.username,
    password: creds.password,
    loginMethod: creds.loginMethod as IScraperCredentials['loginMethod'],
  };

  return {
    credentials,
    studentName: student.name,
    studentExternalId: student.externalId,
    institutionExternalId: new URL(creds.baseUrl).hostname,
    sourceId,
    provider: profile.platform,
    adapterId: `${profile.platform}-browser`,
    options: {
      headless: isHeadless,
      timeout: 30000,
      skipDownloads: true,
      profileDir: join(homedir(), '.scholaracle-scraper', 'browser-profiles', profile.credentialsId),
    },
  };
}

interface IProfileResult {
  readonly profileId: string;
  readonly sourceId: string;
  readonly isPassed: boolean;
  readonly summary: string;
}

async function runProfile(
  profile: IScraperProfile,
  configMgr: ScraperConfig,
  args: IRunnerArgs,
): Promise<IProfileResult> {
  const creds = configMgr.getCredentialsById(profile.credentialsId);
  if (!creds?.password) {
    return {
      profileId: profile.id,
      sourceId: profile.sourceId ?? '?',
      isPassed: false,
      summary: `no stored credentials for "${profile.credentialsId}" — run: npx scholaracle-scraper setup`,
    };
  }

  const ScraperClass = SCRAPERS[profile.platform];
  if (!ScraperClass) {
    return {
      profileId: profile.id,
      sourceId: profile.sourceId ?? '?',
      isPassed: false,
      summary: `no scraper registered for platform "${profile.platform}"`,
    };
  }

  const config = buildScraperConfig(profile, creds, configMgr, args.isHeadless);
  const scraper = new ScraperClass();
  let capturedRaw: Record<string, unknown> | undefined;

  console.log(`\n  ── ${profile.label} ──`);
  const envelope = await scraper.run(config, {
    onProgress,
    onRawData: raw => {
      capturedRaw = raw;
    },
  });

  const validation = validateEnvelope(envelope);
  if (!validation.passed) {
    const errors = validation.checks.filter(c => c.severity === 'error').map(c => c.message);
    return {
      profileId: profile.id,
      sourceId: config.sourceId,
      isPassed: false,
      summary: `envelope validation failed: ${errors.join('; ')}`,
    };
  }

  if (capturedRaw) {
    const dir = saveFixture(FIXTURES_DIR, {
      meta: {
        sourceId: config.sourceId,
        provider: config.provider,
        capturedAt: new Date().toISOString(),
        transformContext: {
          provider: config.provider,
          adapterId: config.adapterId,
          studentExternalId: config.studentExternalId,
          institutionExternalId: config.institutionExternalId,
        },
        totalOps: envelope.ops.length,
        entityCounts: countEntities(envelope),
      },
      rawData: capturedRaw,
      envelope,
    });
    console.log(`    📁 Fixture captured → ${dir}`);
  }

  mkdirSync('output', { recursive: true });
  writeFileSync(join('output', `${config.sourceId}-envelope.json`), JSON.stringify(envelope, null, 2));

  let expectations = loadExpectations(EXPECTATIONS_DIR, config.sourceId);
  if (!expectations || args.isRecord) {
    expectations = draftExpectations(envelope, config.sourceId);
    const path = saveExpectations(EXPECTATIONS_DIR, expectations);
    console.log(`    📏 Standard ${args.isRecord ? 're-recorded' : 'recorded (first run)'} → ${path}`);
  }

  const acceptance = evaluateAcceptance(envelope, expectations);
  for (const check of acceptance.checks) {
    const mark = check.isPassed ? '✓' : '✗';
    console.log(`    ${mark} ${check.name.padEnd(24)} expected >= ${check.expected}, got ${check.actual}`);
  }

  if (args.isUpload && acceptance.isPassed) {
    const configData = configMgr.load();
    if (configData.connectorToken && configData.apiBaseUrl) {
      const uploader = new ScholaracleUploader(configData.apiBaseUrl, configData.connectorToken);
      const result = await uploader.upload(envelope);
      console.log(result.success ? `    ☁️  Uploaded (run ${result.runId})` : `    ❌ Upload failed: ${result.error}`);
      if (!result.success) {
        return {
          profileId: profile.id,
          sourceId: config.sourceId,
          isPassed: false,
          summary: `acceptance passed but upload failed: ${result.error}`,
        };
      }
    }
  }

  return {
    profileId: profile.id,
    sourceId: config.sourceId,
    isPassed: acceptance.isPassed,
    summary: acceptance.isPassed
      ? `${envelope.ops.length} ops, all checks passed`
      : `${acceptance.checks.filter(c => !c.isPassed).length} check(s) below the recorded standard`,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configMgr = new ScraperConfig();
  const allProfiles = configMgr.load().scraperProfiles ?? [];

  const profiles =
    args.profileFilters.length === 0
      ? allProfiles
      : allProfiles.filter(
          p => args.profileFilters.includes(p.id) || args.profileFilters.includes(p.platform),
        );

  if (profiles.length === 0) {
    console.error(
      args.profileFilters.length === 0
        ? '  ✗ No scraper profiles found in ~/.scholaracle-scraper/config.json'
        : `  ✗ No profiles match: ${args.profileFilters.join(', ')} (have: ${allProfiles.map(p => p.id).join(', ')})`,
    );
    process.exit(1);
  }

  console.log('\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Scholaracle Acceptance Runner — the kids are the standard');
  console.log(`  Profiles: ${profiles.map(p => p.id).join(', ')}`);
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const results: IProfileResult[] = [];
  for (const profile of profiles) {
    try {
      results.push(await runProfile(profile, configMgr, args));
    } catch (err) {
      results.push({
        profileId: profile.id,
        sourceId: profile.sourceId ?? '?',
        isPassed: false,
        summary: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log('\n  ━━━━━━━━━━━━━━ Scoreboard ━━━━━━━━━━━━━━');
  for (const r of results) {
    console.log(`  ${r.isPassed ? '✅' : '❌'} ${r.profileId.padEnd(16)} ${r.summary}`);
  }
  console.log('');

  process.exit(results.every(r => r.isPassed) ? 0 : 1);
}

void main();

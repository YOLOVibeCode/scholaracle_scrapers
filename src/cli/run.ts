import inquirer from 'inquirer';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ScraperConfig } from '../core/config';
import { ScholaracleUploader } from '../core/uploader';
import { validateEnvelope } from '../core/validator';
import { BaseScraper } from '../core/base-scraper';
import { FileStrategyStore } from '../core/file-strategy-store';
import { resolveProfileRunIds, resolveManualRunIds } from './run-ids';
import type { IScraperConfig } from '../core/types';

export interface IRunOptions {
  readonly scheduled?: boolean;
  readonly silent?: boolean;
  readonly upload?: boolean;
  readonly profileId?: string;
  readonly configDir?: string;
  readonly skipAssets?: boolean;
  readonly maxDownloads?: string;
}

function discoverScrapers(scrapersRoot?: string): string[] {
  const scrapersDir = scrapersRoot ?? join(__dirname, '..', 'scrapers');
  if (!existsSync(scrapersDir)) return [];
  return readdirSync(scrapersDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_'))
    .map(d => d.name);
}

async function loadScraper(platform: string, scrapersRoot?: string): Promise<BaseScraper> {
  const root = scrapersRoot ?? join(__dirname, '..', 'scrapers');
  const scraperPath = join(root, platform, `${platform}-scraper`);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(scraperPath);
  const ScraperClass = Object.values(mod).find(
    (v): v is new () => BaseScraper => typeof v === 'function' && v.prototype instanceof BaseScraper
  );
  if (!ScraperClass) throw new Error(`No BaseScraper subclass found in ${scraperPath}`);
  return new ScraperClass();
}

export async function runCommand(
  platform?: string,
  options?: IRunOptions,
): Promise<void> {
  const isScheduled = options?.scheduled ?? false;
  const isSilent = options?.silent ?? false;
  const shouldUpload = options?.upload !== false;
  const configDir = options?.configDir;
  const profileId = options?.profileId;
  const skipAssets = options?.skipAssets ?? false;
  const maxDownloads = options?.maxDownloads != null ? parseInt(options.maxDownloads, 10) : undefined;

  const log = isSilent ? () => {} : console.log;
  const scrapersRoot = configDir ? join(configDir, 'src', 'scrapers') : undefined;

  const config = new ScraperConfig(configDir);
  const configData = config.load();

  // Check token
  const tokenStatus = config.getTokenStatus();
  if (shouldUpload && tokenStatus.status === 'expired') {
    console.error('  ✗ Your connector token has expired. Run: npx scholaracle-scraper setup');
    process.exit(1);
  }
  if (shouldUpload && tokenStatus.status === 'missing') {
    console.error('  ✗ No connector token found. Run: npx scholaracle-scraper setup');
    process.exit(1);
  }
  if (tokenStatus.status === 'expiring') {
    log(`  ⚠ Token expires in ${tokenStatus.daysRemaining} days. Visit your dashboard to download a fresh script.`);
  }

  const available = discoverScrapers(scrapersRoot);
  let resolvedPlatform = platform;

  if (profileId) {
    const profile = config.getScraperProfiles().find(p => p.id === profileId);
    if (!profile) {
      console.error('  ✗ Scraper profile not found.');
      process.exit(1);
    }
    resolvedPlatform = profile.platform;
    const creds = config.getCredentialsById(profile.credentialsId);
    if (!creds) {
      console.error('  ✗ Credentials for this profile not found.');
      process.exit(1);
    }
    if (!resolvedPlatform || !available.includes(resolvedPlatform)) {
      console.error(`  ✗ Scraper "${resolvedPlatform}" not found. Run from project root or check config.`);
      process.exit(1);
    }
    const scraper = await loadScraper(resolvedPlatform, scrapersRoot);
    scraper.strategyStore = new FileStrategyStore(config.getConfigDir());
    const students = configData.students ?? [];
    for (const studentId of profile.studentIds) {
      const student = students.find(s => s.id === studentId);
      const studentName = student?.name ?? studentId;
      const { studentExternalId, sourceId } = resolveProfileRunIds(
        student,
        studentId,
        profile,
        resolvedPlatform
      );
      const scraperConfig: IScraperConfig = {
        credentials: { baseUrl: creds.baseUrl, username: creds.username, password: creds.password },
        studentName,
        studentExternalId,
        institutionExternalId: new URL(creds.baseUrl || 'https://unknown').hostname,
        sourceId,
        provider: resolvedPlatform,
        adapterId: scraper.metadata.id,
        options: {
          headless: true,
          skipDownloads: skipAssets,
          ...(maxDownloads != null && !isNaN(maxDownloads) ? { maxConcurrentDownloads: maxDownloads } : {}),
        },
      };
      const runOptions =
        shouldUpload && configData.connectorToken && configData.apiBaseUrl
          ? { apiBaseUrl: configData.apiBaseUrl, connectorToken: configData.connectorToken }
          : undefined;
      try {
        const envelope = await scraper.run(scraperConfig, runOptions);
        const report = validateEnvelope(envelope);
        log(`\n  Validation (${studentName}): ${report.passed ? '✓ passed' : '✗ failed'} (${report.totalOps} ops)`);
        if (!report.passed) {
          const errors = report.checks.filter(c => c.severity === 'error');
          for (const err of errors) log(`    ✗ ${err.message}`);
          process.exit(1);
        }
        if (shouldUpload && configData.connectorToken) {
          log('  Uploading to Scholaracle...');
          const uploader = new ScholaracleUploader(configData.apiBaseUrl, configData.connectorToken);
          const result = await uploader.upload(envelope);
          if (result.success) log(`  ✓ Uploaded ${report.totalOps} items for ${studentName}.`);
          else {
            console.error(`  ✗ Upload failed: ${result.error}`);
            process.exit(1);
          }
        } else if (!shouldUpload) {
          const summary = Object.entries(report.entityCounts)
            .map(([entity, count]) => `${count} ${entity}`)
            .join(', ');
          log(`  Would be synced on upload: ${summary || 'no ops'}. (--no-upload: dry run)`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n  ✗ Scraper failed for ${studentName}: ${msg}`);
        process.exit(1);
      }
    }
    log('');
    return;
  }

  if (!resolvedPlatform && isScheduled) {
    console.error('  ✗ --scheduled mode requires a platform argument');
    process.exit(1);
  }

  if (!resolvedPlatform) {
    const profiles = config.getScraperProfiles();
    let choices: Array<{ name: string; value: string }> = available.map(s => ({ name: s, value: s }));
    if (profiles.length > 0) {
      const profileChoices = profiles.map(p => ({
        name: `${p.label} (${p.platform})`,
        value: `profile:${p.id}`,
      }));
      choices = [
        ...profileChoices,
        { name: '— Enter credentials manually —', value: '__manual__' },
        ...available.map(s => ({ name: s, value: s })),
      ];
    }
    const { selected } = await inquirer.prompt([{
      type: 'list',
      name: 'selected',
      message: 'Which scraper or profile?',
      choices,
    }]);
    if ((selected as string) === '__manual__') {
      const { platform: manualPlatform } = await inquirer.prompt([{
        type: 'list',
        name: 'platform',
        message: 'Platform:',
        choices: available.map(s => ({ name: s, value: s })),
      }]);
      resolvedPlatform = manualPlatform as string;
    } else if ((selected as string).startsWith('profile:')) {
      const pid = (selected as string).replace(/^profile:/, '');
      const profile = config.getScraperProfiles().find(p => p.id === pid);
      if (profile) {
        await runCommand(profile.platform, { ...options, profileId: pid });
        return;
      }
    } else {
      resolvedPlatform = selected as string;
    }
  }

  if (!resolvedPlatform || !available.includes(resolvedPlatform)) {
    console.error(`  ✗ Scraper "${resolvedPlatform}" not found. Available: ${available.join(', ')}`);
    process.exit(1);
  }

  log(`\n  Running ${resolvedPlatform} scraper...`);

  const scraper = await loadScraper(resolvedPlatform, scrapersRoot);
  scraper.strategyStore = new FileStrategyStore(config.getConfigDir());

  let baseUrl: string;
  let username: string;
  let password: string;
  let studentName: string;

  if (isScheduled) {
    const scraperRef = configData.scrapers?.[resolvedPlatform];
    if (!scraperRef) {
      console.error(`  ✗ No saved config for ${resolvedPlatform}. Run interactively first.`);
      process.exit(1);
    }
    baseUrl = '';
    username = '';
    password = '';
    studentName = scraperRef.student;
  } else {
    const answers = await inquirer.prompt([
      { type: 'input', name: 'studentName', message: 'Student name:' },
      { type: 'input', name: 'baseUrl', message: `${scraper.metadata.name} URL:` },
      { type: 'input', name: 'username', message: 'Username/Email:' },
      { type: 'password', name: 'password', message: 'Password:', mask: '*' },
      { type: 'confirm', name: 'save', message: 'Save credentials for future runs?', default: true },
    ]);
    baseUrl = answers.baseUrl;
    username = answers.username;
    password = answers.password;
    studentName = answers.studentName;

    if (answers.save) {
      config.setScraper(resolvedPlatform, {
        student: studentName,
        credentialsRef: `${resolvedPlatform}-${studentName.toLowerCase().replace(/\s+/g, '-')}`,
      });
    }
  }

  const { studentExternalId, sourceId } = resolveManualRunIds(
    studentName ?? '',
    configData.students,
    resolvedPlatform
  );

  const scraperConfig: IScraperConfig = {
    credentials: { baseUrl, username, password },
    studentName,
    studentExternalId,
    institutionExternalId: new URL(baseUrl || 'https://unknown').hostname,
    sourceId,
    provider: resolvedPlatform,
    adapterId: scraper.metadata.id,
    options: {
      headless: true,
      skipDownloads: skipAssets,
      ...(maxDownloads != null && !isNaN(maxDownloads) ? { maxConcurrentDownloads: maxDownloads } : {}),
    },
  };

  const runOptions =
    shouldUpload && configData.connectorToken && configData.apiBaseUrl
      ? { apiBaseUrl: configData.apiBaseUrl, connectorToken: configData.connectorToken }
      : undefined;

  try {
    const envelope = await scraper.run(scraperConfig, runOptions);

    const report = validateEnvelope(envelope);
    log(`\n  Validation: ${report.passed ? '✓ passed' : '✗ failed'} (${report.totalOps} ops)`);

    for (const [entity, count] of Object.entries(report.entityCounts)) {
      log(`    ${entity}: ${count}`);
    }

    if (!report.passed) {
      const errors = report.checks.filter(c => c.severity === 'error');
      for (const err of errors) {
        log(`    ✗ ${err.message}`);
      }
      process.exit(1);
    }

    if (shouldUpload && configData.connectorToken) {
      log('\n  Uploading to Scholaracle...');
      const uploader = new ScholaracleUploader(configData.apiBaseUrl, configData.connectorToken);
      const result = await uploader.upload(envelope);
      if (result.success) {
        log(`  ✓ Upload complete! ${report.totalOps} items synced for ${studentName}.`);
      } else {
        log(`  ✗ Upload failed: ${result.error}`);
        process.exit(1);
      }
    } else if (!shouldUpload) {
      const summary = Object.entries(report.entityCounts)
        .map(([entity, count]) => `${count} ${entity}`)
        .join(', ');
      log(`\n  Would be synced on upload: ${summary || 'no ops'}. (--no-upload: dry run)`);
    }

    log('');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  ✗ Scraper failed: ${msg}`);
    process.exit(1);
  }
}

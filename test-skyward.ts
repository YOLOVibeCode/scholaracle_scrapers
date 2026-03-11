/**
 * Local Skyward scraper runner with live status reporting.
 *
 * Usage:
 *   npx ts-node --transpile-only test-skyward.ts
 *   npx ts-node --transpile-only test-skyward.ts --upload
 *   SKYWARD_USERNAME=... SKYWARD_PASSWORD=... npx ts-node --transpile-only test-skyward.ts --upload
 */

import { SkywardScraper } from './src/scrapers/skyward/skyward-scraper';
import { validateEnvelope } from './src/core/validator';
import { ScholaracleUploader } from './src/core/uploader';
import { ScraperConfig } from './src/core/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { IScraperConfig, IScraperProgress } from './src/core/types';

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

function formatDuration(ms: number | undefined): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function onProgress(p: IScraperProgress): void {
  const icon = PHASE_ICONS[p.phase] ?? '•';
  const dur = p.durationMs ? ` (${formatDuration(p.durationMs)})` : '';
  const detail = p.detail ? ` ${JSON.stringify(p.detail)}` : '';
  const ts = new Date(p.timestamp).toLocaleTimeString();
  console.log(`  ${icon} [${ts}] ${p.phase.toUpperCase().padEnd(20)} ${p.message}${dur}${detail}`);
}

async function main(): Promise<void> {
  mkdirSync('output', { recursive: true });
  const shouldUpload = process.argv.includes('--upload');
  const runStart = Date.now();

  const configMgr = new ScraperConfig();
  const configData = configMgr.load();

  const storedCreds = configMgr.getCredentialsById('ldisd-skyward-direct')
    ?? configMgr.getCredentialsById('ldisd-google-sso');

  const baseUrl = process.env['SKYWARD_BASE_URL']
    ?? storedCreds?.baseUrl
    ?? 'https://skyward.iscorp.com/scripts/wsisa.dll/WService=wscomlakedallastx/seplog01.w';
  const username = process.env['SKYWARD_USERNAME'] ?? storedCreds?.username ?? 'Jessica.Lewis';
  const password = process.env['SKYWARD_PASSWORD'] ?? storedCreds?.password;

  if (!password) {
    console.error('\n  ✗ No Skyward password found. Either:');
    console.error('    1. Set SKYWARD_PASSWORD env var: SKYWARD_PASSWORD=xxx npx ts-node --transpile-only test-skyward.ts');
    console.error('    2. Run "npx scholaracle-scraper setup" to store credentials\n');
    process.exit(1);
  }

  const config: IScraperConfig = {
    credentials: {
      baseUrl,
      username,
      password,
      loginMethod: 'direct',
    },
    studentName: 'Ava Lewis',
    studentExternalId: 'ava-lewis',
    institutionExternalId: 'skyward.iscorp.com',
    sourceId: 'skyward-ava-lewis',
    provider: 'skyward',
    adapterId: 'skyward-browser',
    options: {
      headless: false,
      timeout: 30000,
    },
  };

  const runOptions = {
    apiBaseUrl: shouldUpload ? configData.apiBaseUrl : undefined,
    connectorToken: shouldUpload ? configData.connectorToken : undefined,
    onProgress,
  };

  const scraper = new SkywardScraper();

  console.log('\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Skyward Family Access — Local Scraper');
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Student:  ${config.studentName}`);
  console.log(`  Portal:   ${baseUrl.substring(0, 60)}...`);
  console.log(`  Username: ${username}`);
  console.log(`  Upload:   ${shouldUpload ? 'YES → ' + configData.apiBaseUrl : 'NO (local only)'}`);
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const envelope = await scraper.run(config, runOptions);

    console.log('\n  ── Validation ──');
    onProgress({
      phase: 'validating',
      message: 'Checking envelope integrity...',
      timestamp: new Date().toISOString(),
    });
    const report = validateEnvelope(envelope);

    console.log(`\n  Result: ${report.passed ? '✅ PASSED' : '❌ FAILED'} (${report.totalOps} ops)`);
    console.log('  Entity breakdown:');
    for (const [entity, count] of Object.entries(report.entityCounts)) {
      console.log(`    • ${entity}: ${count}`);
    }

    if (!report.passed) {
      const errors = report.checks.filter(c => c.severity === 'error');
      console.log('\n  Errors:');
      for (const err of errors) console.log(`    ✗ ${err.message}`);
      process.exit(1);
    }

    writeFileSync('output/skyward-envelope.json', JSON.stringify(envelope, null, 2));
    console.log('\n  📁 Envelope saved → output/skyward-envelope.json');

    if (shouldUpload && configData.connectorToken && configData.apiBaseUrl) {
      console.log('\n  ── Upload ──');
      onProgress({
        phase: 'uploading',
        message: `Uploading ${report.totalOps} ops to ${configData.apiBaseUrl}...`,
        timestamp: new Date().toISOString(),
      });
      const uploader = new ScholaracleUploader(configData.apiBaseUrl, configData.connectorToken);
      const result = await uploader.upload(envelope);
      if (result.success) {
        console.log(`  ✅ Upload complete! ${report.totalOps} items synced.`);
        console.log(`     Run ID: ${result.runId}`);
      } else {
        console.error(`  ❌ Upload failed: ${result.error}`);
        process.exit(1);
      }
    }

    const courses = envelope.ops.filter(o => o.entity === 'course');
    const grades = envelope.ops.filter(o => o.entity === 'gradeSnapshot');
    const assignments = envelope.ops.filter(o => o.entity === 'assignment');

    console.log('\n  ── Data Summary ──');
    console.log(`  Courses: ${courses.length}`);
    for (const c of courses) {
      const rec = c.record as Record<string, unknown>;
      console.log(`    📚 ${rec['title'] ?? 'Untitled'} (period ${rec['period'] ?? '?'})`);
    }
    console.log(`\n  Grade Snapshots: ${grades.length}`);
    for (const g of grades) {
      const rec = g.record as Record<string, unknown>;
      const pct = rec['currentPercent'] ?? rec['percent'] ?? '?';
      const letter = rec['currentLetterGrade'] ?? rec['letterGrade'] ?? '';
      console.log(`    📊 ${g.key.externalId}: ${pct}% ${letter}`);
    }
    console.log(`\n  Assignments: ${assignments.length}`);
    const missing = assignments.filter(a => (a.record as Record<string, unknown>)['status'] === 'missing');
    if (missing.length > 0) {
      console.log(`    ⚠️  ${missing.length} missing assignments`);
    }

    const totalMs = Date.now() - runStart;
    console.log(`\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Total time: ${formatDuration(totalMs)}`);
    console.log(`  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  } catch (err) {
    const totalMs = Date.now() - runStart;
    console.error(`\n  ❌ Scraper failed after ${formatDuration(totalMs)}:`);
    console.error(`     ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      const frames = err.stack.split('\n').slice(1, 6);
      for (const f of frames) console.error(`     ${f.trim()}`);
    }
    process.exit(1);
  }
}

main();

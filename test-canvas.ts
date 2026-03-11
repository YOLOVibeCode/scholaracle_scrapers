/**
 * Manual test: Canvas scraper via Google SSO for LDISD.
 * Reads credentials from ~/.scholaracle-scraper/ config or env vars.
 *
 * Usage:
 *   npx ts-node --transpile-only test-canvas.ts              # scrape + validate only
 *   npx ts-node --transpile-only test-canvas.ts --upload      # scrape + validate + upload
 */

import { CanvasScraper } from './src/scrapers/canvas/canvas-scraper';
import { validateEnvelope } from './src/core/validator';
import { ScholaracleUploader } from './src/core/uploader';
import { ScraperConfig } from './src/core/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { IScraperConfig } from './src/core/types';

async function main(): Promise<void> {
  mkdirSync('output', { recursive: true });
  const shouldUpload = process.argv.includes('--upload');

  const configMgr = new ScraperConfig();
  const configData = configMgr.load();

  const baseUrl = process.env['CANVAS_BASE_URL'] ?? 'https://ldisd.instructure.com';
  const username = process.env['CANVAS_USERNAME'] ?? '';
  const password = process.env['CANVAS_PASSWORD'] ?? '';

  if (!username || !password) {
    console.error('  ✗ Set CANVAS_USERNAME and CANVAS_PASSWORD env vars (or use npx scholaracle-scraper run canvas)');
    process.exit(1);
  }

  const config: IScraperConfig = {
    credentials: {
      baseUrl,
      username,
      password,
      loginMethod: 'google_sso',
    },
    studentName: 'Ava Lewis',
    studentExternalId: 'ava-lewis',
    institutionExternalId: new URL(baseUrl).hostname,
    sourceId: 'canvas-ava-lewis',
    provider: 'canvas',
    adapterId: 'canvas-browser',
    options: {
      headless: false,
      timeout: 30000,
      skipDownloads: true,
    },
  };

  const runOptions =
    shouldUpload && configData.connectorToken && configData.apiBaseUrl
      ? { apiBaseUrl: configData.apiBaseUrl, connectorToken: configData.connectorToken }
      : undefined;

  const scraper = new CanvasScraper();

  console.log('\n  ── Canvas Scraper (LDISD via Google SSO) ──\n');
  if (shouldUpload) console.log('  Upload mode: ON\n');

  try {
    const envelope = await scraper.run(config, runOptions);
    const report = validateEnvelope(envelope);

    console.log(`\n  Validation: ${report.passed ? '✓ passed' : '✗ failed'} (${report.totalOps} ops)`);
    for (const [entity, count] of Object.entries(report.entityCounts)) {
      console.log(`    ${entity}: ${count}`);
    }

    if (!report.passed) {
      const errors = report.checks.filter(c => c.severity === 'error');
      for (const err of errors) console.log(`    ✗ ${err.message}`);
      process.exit(1);
    }

    writeFileSync('output/canvas-envelope.json', JSON.stringify(envelope, null, 2));
    console.log('\n  ✓ Envelope saved to output/canvas-envelope.json');

    if (shouldUpload && configData.connectorToken && configData.apiBaseUrl) {
      console.log('\n  Uploading to Scholaracle...');
      const uploader = new ScholaracleUploader(configData.apiBaseUrl, configData.connectorToken);
      const result = await uploader.upload(envelope);
      if (result.success) {
        console.log(`  ✓ Upload complete! ${report.totalOps} items synced. Run ID: ${result.runId}`);
      } else {
        console.error(`  ✗ Upload failed: ${result.error}`);
        process.exit(1);
      }
    }

    const rawOps = envelope.ops.slice(0, 5);
    console.log(`\n  First 5 ops preview:`);
    for (const op of rawOps) {
      console.log(`    ${op.op} ${op.entity}: ${JSON.stringify(op.key).substring(0, 80)}`);
    }
    console.log('');
  } catch (err) {
    console.error('\n  ✗ Scraper failed:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error) console.error(err.stack);
  }
}

main();

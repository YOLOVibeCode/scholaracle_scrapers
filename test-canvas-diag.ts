/**
 * Check multiple possible Canvas URLs for LDISD.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

async function checkUrl(url: string): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    const finalUrl = page.url();
    const title = await page.title();
    const status = resp?.status() ?? 'N/A';
    console.log(`  ${url}`);
    console.log(`    → ${finalUrl} (${status})`);
    console.log(`    Title: ${title}\n`);
  } catch (err) {
    console.log(`  ${url}`);
    console.log(`    → Error: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  await browser.close();
}

async function main(): Promise<void> {
  mkdirSync('output', { recursive: true });
  console.log('\n  ── Canvas URL Check ──\n');

  const urls = [
    'https://ldisd.instructure.com',
    'https://lakedallas.instructure.com',
    'https://ldhs.instructure.com',
    'https://classroom.google.com',
  ];

  for (const url of urls) {
    await checkUrl(url);
  }

  console.log('  ✓ Done.\n');
}

main().catch(console.error);

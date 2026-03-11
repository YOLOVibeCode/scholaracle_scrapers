import inquirer from 'inquirer';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ScraperConfig } from '../core/config';
import { AiClient } from '../ai/client';

export async function troubleshootCommand(): Promise<void> {
  console.log('\n  Scholaracle Scraper Troubleshooter (AI-Powered)');
  console.log('  ────────────────────────────────────────────────\n');

  const config = new ScraperConfig();
  const configData = config.load();

  if (!configData.aiProvider || !configData.aiApiKey) {
    console.log('  No AI provider configured.');
    console.log('  Run: npx scholaracle-scraper setup');
    console.log('  Or use the prompt template in prompts/troubleshoot-scraper.md\n');
    return;
  }

  // Discover scrapers
  const scrapersDir = join(__dirname, '..', 'scrapers');
  const available = existsSync(scrapersDir)
    ? readdirSync(scrapersDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_'))
        .map(d => d.name)
    : [];

  const { problem } = await inquirer.prompt([{
    type: 'list',
    name: 'problem',
    message: 'What went wrong?',
    choices: [
      { name: 'Scraper failed during run', value: 'run_failed' },
      { name: "Scraper won't authenticate", value: 'auth_failed' },
      { name: 'Data looks wrong or incomplete', value: 'bad_data' },
      { name: 'Upload failed', value: 'upload_failed' },
      { name: 'Other / paste error manually', value: 'manual' },
    ],
  }]);

  let scraperCode = '';
  let errorText = '';

  if (problem !== 'manual' && available.length > 0) {
    const { platform } = await inquirer.prompt([{
      type: 'list',
      name: 'platform',
      message: 'Which scraper?',
      choices: available,
    }]);

    // Read the scraper source
    const scraperPath = join(scrapersDir, platform, `${platform}-scraper.ts`);
    if (existsSync(scraperPath)) {
      scraperCode = readFileSync(scraperPath, 'utf-8');
    }

    // Read latest log if available
    const logDir = join(process.env['HOME'] ?? '~', '.scholaracle-scraper', 'logs');
    if (existsSync(logDir)) {
      const logs = readdirSync(logDir)
        .filter(f => f.startsWith(platform))
        .sort()
        .reverse();
      if (logs[0]) {
        const logContent = readFileSync(join(logDir, logs[0]), 'utf-8');
        errorText = logContent.slice(-2000);
      }
    }
  }

  if (!errorText) {
    const { error } = await inquirer.prompt([{
      type: 'editor',
      name: 'error',
      message: 'Paste the error message or log output:',
    }]);
    errorText = error;
  }

  if (!scraperCode) {
    const { code } = await inquirer.prompt([{
      type: 'editor',
      name: 'code',
      message: 'Paste the relevant scraper code (optional, press Enter to skip):',
    }]);
    scraperCode = code;
  }

  console.log('\n  Analyzing with AI...\n');

  try {
    const aiClient = new AiClient(configData.aiProvider, configData.aiApiKey);
    const analysis = await aiClient.troubleshoot(errorText, scraperCode);

    console.log('  ──── AI Analysis ────\n');
    console.log(analysis);
    console.log('\n  ─────────────────────\n');

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  ✗ Analysis failed: ${msg}`);
    console.log('  Try using the prompt template in prompts/troubleshoot-scraper.md instead.\n');
  }
}

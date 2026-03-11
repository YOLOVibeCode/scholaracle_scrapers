import inquirer from 'inquirer';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ScraperConfig } from '../core/config';
import type { IScraperSchedule } from '../core/config';

function discoverScrapers(): string[] {
  const scrapersDir = join(__dirname, '..', 'scrapers');
  if (!existsSync(scrapersDir)) return [];
  return readdirSync(scrapersDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_'))
    .map(d => d.name);
}

export async function scheduleCommand(options?: { list?: boolean; remove?: boolean; logs?: boolean }): Promise<void> {
  const config = new ScraperConfig();
  const configData = config.load();

  if (options?.list) {
    const schedules = configData.schedules ?? [];
    if (schedules.length === 0) {
      console.log('\n  No schedules configured. Run: npx scholaracle-scraper schedule\n');
      return;
    }
    console.log('\n  Current schedules:');
    for (const s of schedules) {
      const days = s.days.join(', ');
      console.log(`    ${s.scraper} — ${s.time} (${days}) [${s.enabled ? 'enabled' : 'disabled'}]`);
    }
    console.log('');
    return;
  }

  if (options?.remove) {
    config.update({ schedules: [] });
    console.log('\n  ✓ All schedules removed.\n');
    return;
  }

  if (options?.logs) {
    console.log('\n  Run logs are saved to ~/.scholaracle-scraper/logs/');
    console.log('  This feature is coming soon.\n');
    return;
  }

  // Interactive schedule wizard
  console.log('\n  Scholaracle Scraper Scheduler');
  console.log('  ────────────────────────────\n');

  const available = discoverScrapers();
  if (available.length === 0) {
    console.log('  No scrapers found. Run a scraper first.\n');
    return;
  }

  const { scrapers } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'scrapers',
    message: 'Which scrapers to schedule?',
    choices: available.map(s => ({ name: s, value: s, checked: true })),
  }]);

  const { presets } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'presets',
    message: 'When should they run?',
    choices: [
      { name: 'Before school (6:30 AM)', value: '06:30', checked: true },
      { name: 'After school (3:30 PM)', value: '15:30', checked: true },
      { name: 'Evening (8:30 PM)', value: '20:30', checked: true },
    ],
  }]);

  const { days } = await inquirer.prompt([{
    type: 'list',
    name: 'days',
    message: 'What days?',
    choices: [
      { name: 'Monday - Friday (school days)', value: ['mon', 'tue', 'wed', 'thu', 'fri'] },
      { name: 'Every day', value: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    ],
  }]);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const schedules: IScraperSchedule[] = [];

  for (const scraper of scrapers as string[]) {
    for (const time of presets as string[]) {
      schedules.push({
        scraper,
        time,
        days,
        timezone,
        enabled: true,
      });
    }
  }

  config.update({ schedules });

  console.log(`\n  ✓ Created ${schedules.length} scheduled tasks`);
  console.log(`    (${(scrapers as string[]).length} scrapers × ${(presets as string[]).length} times)\n`);
  console.log(`  Timezone: ${timezone}`);
  console.log('  View schedule: npx scholaracle-scraper schedule --list');
  console.log('');

  // TODO: Install OS-level scheduler (launchd/cron/schtasks)
  console.log('  Note: OS-level scheduling (launchd/cron) will be configured in a future release.');
  console.log('  For now, schedules are saved to config and can be used with external schedulers.\n');
}

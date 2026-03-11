#!/usr/bin/env node

import { Command } from 'commander';
import { setupCommand } from '../src/cli/setup';
import { runCommand, type IRunOptions } from '../src/cli/run';
import { validateCommand } from '../src/cli/validate';
import { generateCommand } from '../src/cli/generate';
import { scheduleCommand } from '../src/cli/schedule';
import { troubleshootCommand } from '../src/cli/troubleshoot';
import { pruneCommand } from '../src/cli/prune';

const program = new Command();

program
  .name('scholaracle-scraper')
  .description('Run and schedule scrapers (Canvas, Skyward, Aeries, custom). Download and run on your machine.')
  .version('0.1.0');

program
  .command('setup')
  .description('Configure API keys and connect to your Scholaracle account')
  .action(setupCommand);

program
  .command('run [platform]')
  .description('Run a scraper, validate output, and upload to Scholaracle')
  .option('--scheduled', 'Run in non-interactive mode (for scheduled runs)')
  .option('--silent', 'Suppress terminal output, log to file only')
  .option('--no-upload', 'Scrape and validate only, do not upload')
  .option('--skip-assets', 'Do not download or upload assets (keep portal URLs)')
  .option('--max-downloads <n>', 'Max concurrent asset downloads (default: 5)', '5')
  .action((platform: string | undefined, cmd: { opts: () => IRunOptions }) =>
    runCommand(platform, cmd.opts()));

program
  .command('validate [platform]')
  .description('Run a scraper and validate output (no upload)')
  .action(validateCommand);

program
  .command('generate')
  .description('Create a custom scraper on your machine (wizard + AI). Use this downloadable script separately from batch runs.')
  .option('-o, --output-dir <path>', 'Write generated scraper to this directory (e.g. to copy into runner later)')
  .action((opts: { outputDir?: string }) => generateCommand({ outputDir: opts.outputDir }));

program
  .command('schedule')
  .description('Set up automatic scheduled runs')
  .option('--list', 'Show current schedule')
  .option('--remove', 'Remove all scheduled runs')
  .option('--logs', 'Show recent run logs')
  .action(scheduleCommand);

program
  .command('troubleshoot')
  .description('Use AI to diagnose and fix scraper errors')
  .action(troubleshootCommand);

program
  .command('prune <sourceId>')
  .description('Prune local asset manifest entries (optionally by academic term)')
  .option('--term <termId>', 'Remove only entries for this academic term')
  .action((sourceId: string, opts: { term?: string }) => pruneCommand(sourceId, opts));

program.parse(process.argv);

/**
 * Unified local scraper — runs all configured scrapers for a student,
 * reconciles grades across SIS/LMS with optional AI normalization,
 * and uploads to Scholarmancy.
 *
 * Usage:
 *   npx ts-node --transpile-only run-all.ts
 *   npx ts-node --transpile-only run-all.ts --upload
 *   npx ts-node --transpile-only run-all.ts --platform skyward
 *   npx ts-node --transpile-only run-all.ts --student "Ava Lewis" --upload
 *   npx ts-node --transpile-only run-all.ts --skip-ai --headless
 *   npx ts-node --transpile-only run-all.ts --upload --skip-downloads
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ScraperConfig, type IScraperProfile, type IStudentProfile } from './src/core/config';
import { createScraper, isProviderSis } from './src/core/scraper-registry';
import { validateEnvelope } from './src/core/validator';
import { ScholaracleUploader } from './src/core/uploader';
import { reconcileGrades, type IReconciledGrade } from './src/core/grade-reconciler';
import { AiClient, type AiProvider } from './src/ai/client';
import { getCachedNormalizations, setCachedNormalizations } from './src/core/course-normalization-cache';
import type { IScraperConfig, IScraperProgress, ISlcIngestEnvelopeV1 } from './src/core/types';

// ---------------------------------------------------------------------------
// Interactive prompts
// ---------------------------------------------------------------------------

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptForAiSetup(
  configMgr: ScraperConfig,
  skipAi: boolean,
): Promise<{ provider?: AiProvider; apiKey?: string }> {
  if (skipAi) return {};

  const configData = configMgr.load();
  if (configData.aiProvider && configData.aiApiKey) {
    return { provider: configData.aiProvider as AiProvider, apiKey: configData.aiApiKey };
  }

  console.log('\n  \u{1F916} AI-assisted course normalization is available but not configured.');
  console.log('  This helps match courses like "ALGEBRA 1" (Skyward) with "algebra" (Canvas).\n');

  const choice = await prompt('  Would you like to set up AI normalization? (y/n): ');
  if (choice.toLowerCase() !== 'y') {
    console.log('  Skipping AI -- using rule-based normalization only.\n');
    return {};
  }

  console.log('\n  Choose an AI provider:');
  console.log('    1. Google Gemini (free tier, recommended)');
  console.log('    2. OpenAI GPT-4');
  console.log('    3. Anthropic Claude\n');

  const providerChoice = await prompt('  Enter choice (1-3): ');
  let provider: AiProvider;
  let helpUrl: string;

  switch (providerChoice) {
    case '1':
      provider = 'gemini';
      helpUrl = 'https://aistudio.google.com/apikey';
      break;
    case '2':
      provider = 'openai';
      helpUrl = 'https://platform.openai.com/api-keys';
      break;
    case '3':
      provider = 'anthropic';
      helpUrl = 'https://console.anthropic.com/settings/keys';
      break;
    default:
      console.log('  Invalid choice. Skipping AI setup.\n');
      return {};
  }

  console.log(`\n  Get your ${provider.toUpperCase()} API key here: ${helpUrl}`);
  const apiKey = await prompt(`  Enter your ${provider.toUpperCase()} API key: `);

  if (!apiKey) {
    console.log('  No API key provided. Skipping AI setup.\n');
    return {};
  }

  // Save to config
  configMgr.update({ aiProvider: provider, aiApiKey: apiKey });
  console.log(`  \u{2705} ${provider.toUpperCase()} API key saved to ~/.scholaracle-scraper/config.json\n`);

  return { provider, apiKey };
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface ICliArgs {
  readonly upload: boolean;
  readonly headless: boolean;
  readonly skipAi: boolean;
  readonly skipDownloads: boolean;
  readonly studentFilter?: string;
  readonly platformFilter?: string;
}

function parseArgs(): ICliArgs {
  const args = process.argv.slice(2);
  let studentFilter: string | undefined;
  let platformFilter: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--student' && args[i + 1]) studentFilter = args[++i];
    if (args[i] === '--platform' && args[i + 1]) platformFilter = args[++i];
  }
  return {
    upload: args.includes('--upload'),
    headless: !args.includes('--headed'),
    skipAi: args.includes('--skip-ai'),
    skipDownloads: args.includes('--skip-downloads'),
    studentFilter,
    platformFilter,
  };
}

// ---------------------------------------------------------------------------
// Progress display
// ---------------------------------------------------------------------------

const PHASE_ICONS: Record<string, string> = {
  initializing: '\u{1F527}', authenticating: '\u{1F511}',
  discovering_students: '\u{1F465}', switching_student: '\u{1F464}',
  scraping: '\u{1F4E1}', transforming: '\u{2699}\uFE0F',
  processing_assets: '\u{1F4E6}', validating: '\u{2705}',
  uploading: '\u{2601}\uFE0F', cleanup: '\u{1F9F9}',
  completed: '\u{1F389}', failed: '\u{274C}',
};

function fmtDur(ms: number | undefined): string {
  if (!ms) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function makeProgressHandler(label: string): (p: IScraperProgress) => void {
  return (p) => {
    const icon = PHASE_ICONS[p.phase] ?? '\u{2022}';
    const dur = p.durationMs ? ` (${fmtDur(p.durationMs)})` : '';
    const ts = new Date(p.timestamp).toLocaleTimeString();
    console.log(`  ${icon} [${label}] [${ts}] ${p.phase.toUpperCase().padEnd(20)} ${p.message}${dur}`);
  };
}

// ---------------------------------------------------------------------------
// Config -> IScraperConfig builder
// ---------------------------------------------------------------------------

function buildScraperConfig(
  profile: IScraperProfile,
  student: IStudentProfile,
  configMgr: ScraperConfig,
  headless: boolean,
  skipDownloads: boolean,
): IScraperConfig | null {
  const ds = student.dataSources?.find(d => d.sourceId === profile.sourceId);
  const portalUrl = ds?.portalBaseUrl ?? '';

  // Try profile's credentialsId first, then platform-specific fallback
  let creds = configMgr.getCredentialsById(profile.credentialsId);
  if (!creds || !creds.password) {
    const allCreds = configMgr.getCredentials();
    creds = allCreds.find(c =>
      c.baseUrl === portalUrl ||
      c.id.toLowerCase().includes(profile.platform.toLowerCase()),
    );
  }

  if (!creds?.password) {
    console.warn(`  \u{26A0}\uFE0F  No credentials found for profile "${profile.id}" (tried ${profile.credentialsId})`);
    return null;
  }

  return {
    credentials: {
      baseUrl: creds.baseUrl || portalUrl,
      username: creds.username,
      password: creds.password,
      loginMethod: (creds.loginMethod as 'direct' | 'google_sso') ?? 'direct',
    },
    studentName: student.name,
    studentExternalId: student.externalId,
    institutionExternalId: new URL(creds.baseUrl || portalUrl).hostname,
    sourceId: profile.sourceId ?? `${profile.platform}-${student.externalId}`,
    provider: profile.platform,
    adapterId: `${profile.platform}-browser`,
    options: {
      headless,
      timeout: 30000,
      ...(skipDownloads ? { skipDownloads: true } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// AI normalization
// ---------------------------------------------------------------------------

async function buildCanonicalMap(
  envelopes: ReadonlyArray<{ readonly envelope: ISlcIngestEnvelopeV1; readonly provider: string }>,
  configData: { aiProvider?: string; aiApiKey?: string },
  skipAi: boolean,
): Promise<Record<string, string>> {
  const allTitles: { raw: string; provider: string; period?: string }[] = [];
  for (const { envelope, provider } of envelopes) {
    for (const op of envelope.ops) {
      if (op.entity === 'course') {
        const title = (op.record?.title as string) ?? '';
        const period = (op.record?.period as string) ?? undefined;
        if (title) allTitles.push({ raw: title, provider, period });
      }
    }
  }

  if (allTitles.length === 0 || skipAi) return {};

  // Check cache first
  const cached = getCachedNormalizations(allTitles);
  const uncached = allTitles.filter(t => !cached[t.raw]);

  if (uncached.length === 0) {
    console.log('  \u{1F4BE} All course titles found in cache');
    return cached;
  }

  if (!configData.aiProvider || !configData.aiApiKey) {
    console.log('  \u{26A0}\uFE0F  No AI provider configured -- using rule-based normalization only');
    return cached;
  }

  console.log(`  \u{1F916} Normalizing ${uncached.length} course titles via AI (${configData.aiProvider})...`);
  try {
    const ai = new AiClient(configData.aiProvider as AiProvider, configData.aiApiKey);
    const aiResult = await ai.normalizeCourseTitles(uncached);

    // Cache the results
    const toCache = Object.entries(aiResult).map(([raw, canonical]) => {
      const src = uncached.find(t => t.raw === raw);
      return { raw, provider: src?.provider ?? '', canonical };
    });
    setCachedNormalizations(toCache);

    return { ...cached, ...aiResult };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  \u{26A0}\uFE0F  AI normalization failed: ${msg}. Falling back to rule-based.`);
    return cached;
  }
}

// ---------------------------------------------------------------------------
// Reconciliation report
// ---------------------------------------------------------------------------

function printReconciliationReport(grades: readonly IReconciledGrade[]): void {
  if (grades.length === 0) {
    console.log('  No grade data to reconcile.\n');
    return;
  }

  const colW = { name: 22, sis: 14, lms: 14, letter: 8, delta: 8, src: 10 };
  const sep = '-'.repeat(colW.name + colW.sis + colW.lms + colW.letter + colW.delta + colW.src + 10);

  console.log(`\n  ${sep}`);
  console.log(
    `  ${'Course'.padEnd(colW.name)}` +
    `${'SIS Grade'.padEnd(colW.sis)}` +
    `${'LMS Grade'.padEnd(colW.lms)}` +
    `${'Letter'.padEnd(colW.letter)}` +
    `${'Delta'.padEnd(colW.delta)}` +
    `${'Source'.padEnd(colW.src)}`
  );
  console.log(`  ${sep}`);

  for (const g of grades) {
    const name = g.courseName.substring(0, colW.name - 1).padEnd(colW.name);
    const sis = g.officialGrade != null && g.source === 'sis'
      ? `${g.officialGrade}%`.padEnd(colW.sis)
      : 'N/A'.padEnd(colW.sis);
    const lms = g.lmsGrade != null
      ? `${g.lmsGrade}%`.padEnd(colW.lms)
      : 'N/A'.padEnd(colW.lms);
    const letter = (g.letterGrade ?? '--').padEnd(colW.letter);
    const delta = g.delta != null
      ? `${g.delta > 0 ? '+' : ''}${g.delta.toFixed(1)}`.padEnd(colW.delta)
      : '--'.padEnd(colW.delta);
    const src = g.source.toUpperCase() + (g.discrepancy ? ' (!)' : '');
    console.log(`  ${name}${sis}${lms}${letter}${delta}${src}`);
  }
  console.log(`  ${sep}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cliArgs = parseArgs();
  const runStart = Date.now();
  mkdirSync('output', { recursive: true });

  const configMgr = new ScraperConfig();
  let configData = configMgr.load();

  const students = configData.students ?? [];
  const profiles = configData.scraperProfiles ?? [];

  if (students.length === 0) {
    console.error('\n  \u{274C} No students configured. Run: npx scholaracle-scraper setup\n');
    process.exit(1);
  }

  // Prompt for AI setup if needed
  const aiConfig = await promptForAiSetup(configMgr, cliArgs.skipAi);
  if (aiConfig.provider && aiConfig.apiKey) {
    configData = configMgr.load(); // Reload after potential update
  }

  console.log('\n  \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}');
  console.log('  Scholarmancy Unified Scraper');
  console.log('  \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}');
  console.log(`  Upload:   ${cliArgs.upload ? 'YES \u{2192} ' + configData.apiBaseUrl : 'NO (local only)'}`);
  console.log(`  Assets:   ${cliArgs.skipDownloads ? 'SKIP (--skip-downloads)' : cliArgs.upload ? 'YES (download + re-upload)' : 'SKIP (local-only mode)'}`);
  console.log(`  Headless: ${cliArgs.headless ? 'YES' : 'NO (visible browser)'}`);
  console.log(`  AI:       ${cliArgs.skipAi ? 'DISABLED' : configData.aiProvider ?? 'not configured'}`);
  if (cliArgs.platformFilter) console.log(`  Platform: ${cliArgs.platformFilter} only`);
  if (cliArgs.studentFilter) console.log(`  Student:  ${cliArgs.studentFilter} only`);
  console.log('');

  let exitCode = 0;

  for (const student of students) {
    if (cliArgs.studentFilter && !student.name.toLowerCase().includes(cliArgs.studentFilter.toLowerCase())) {
      continue;
    }

    console.log(`  \u{1F393} Student: ${student.name} (${student.externalId})`);
    console.log(`  ${'─'.repeat(45)}`);

    // Find all scraper profiles for this student, sorted: SIS first
    const studentProfiles = profiles
      .filter(p => p.studentIds.includes(student.id))
      .filter(p => !cliArgs.platformFilter || p.platform.toLowerCase() === cliArgs.platformFilter.toLowerCase())
      .sort((a, b) => {
        const aIsSis = isProviderSis(a.platform) ? 0 : 1;
        const bIsSis = isProviderSis(b.platform) ? 0 : 1;
        return aIsSis - bIsSis;
      });

    if (studentProfiles.length === 0) {
      console.log('  No scraper profiles found for this student.\n');
      continue;
    }

    const results: { profile: IScraperProfile; envelope: ISlcIngestEnvelopeV1; provider: string }[] = [];
    const failures: { profile: IScraperProfile; error: string }[] = [];

    // Run each scraper sequentially
    for (const profile of studentProfiles) {
      console.log(`\n  \u{25B6} ${profile.label} (${profile.platform})`);

      const scraperConfig = buildScraperConfig(profile, student, configMgr, cliArgs.headless, cliArgs.skipDownloads);
      if (!scraperConfig) {
        failures.push({ profile, error: 'Missing credentials' });
        continue;
      }

      try {
        const scraper = createScraper(profile.platform);
        const envelope = await scraper.run(scraperConfig, {
          apiBaseUrl: cliArgs.upload ? configData.apiBaseUrl : undefined,
          connectorToken: cliArgs.upload ? configData.connectorToken : undefined,
          onProgress: makeProgressHandler(profile.platform.toUpperCase()),
        });

        const report = validateEnvelope(envelope);
        console.log(`  \u{2705} Validated: ${report.passed ? 'PASSED' : 'FAILED'} (${report.totalOps} ops)`);
        for (const [entity, count] of Object.entries(report.entityCounts)) {
          console.log(`     ${entity}: ${count}`);
        }

        // Summarize attachment counts
        let attachmentCount = 0;
        let assignmentsWithAttachments = 0;
        for (const op of envelope.ops) {
          if (op.entity === 'assignment' && op.record) {
            const rec = op.record as Record<string, unknown>;
            const atts = rec['attachments'];
            if (Array.isArray(atts) && atts.length > 0) {
              assignmentsWithAttachments++;
              attachmentCount += atts.length;
            }
          }
        }
        if (attachmentCount > 0) {
          console.log(`     \u{1F4CE} ${attachmentCount} attachment(s) across ${assignmentsWithAttachments} assignment(s)`);
        }

        if (!report.passed) {
          const errors = report.checks.filter(c => c.severity === 'error');
          for (const err of errors) console.log(`     \u{274C} ${err.message}`);
          failures.push({ profile, error: `Validation failed: ${errors.map(e => e.message).join('; ')}` });
          continue;
        }

        // Save individual envelope
        const outPath = `output/${profile.platform}-envelope.json`;
        writeFileSync(outPath, JSON.stringify(envelope, null, 2));
        console.log(`  \u{1F4C1} Saved \u{2192} ${outPath}`);

        results.push({ profile, envelope, provider: profile.platform });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  \u{274C} ${profile.platform} failed: ${msg}`);
        failures.push({ profile, error: msg });
      }
    }

    // --- Cross-source reconciliation ---
    const sisEnvelopes = results.filter(r => isProviderSis(r.provider));
    const lmsEnvelopes = results.filter(r => !isProviderSis(r.provider));

    if (sisEnvelopes.length > 0 && lmsEnvelopes.length > 0) {
      console.log('\n  \u{1F504} Reconciling grades across sources...');

      const canonicalMap = await buildCanonicalMap(results, configData, cliArgs.skipAi);

      const sisOps = sisEnvelopes.flatMap(r => r.envelope.ops);
      const lmsOps = lmsEnvelopes.flatMap(r => r.envelope.ops);
      const reconciled = reconcileGrades(sisOps, lmsOps, { canonicalMap });

      printReconciliationReport(reconciled);

      // Save reconciliation report
      writeFileSync('output/reconciliation-report.json', JSON.stringify(reconciled, null, 2));
      console.log('  \u{1F4C1} Saved \u{2192} output/reconciliation-report.json');
    } else if (results.length > 0) {
      console.log('\n  \u{2139}\uFE0F  Only one source available -- no cross-source reconciliation needed.');
    }

    // --- Upload ---
    if (cliArgs.upload && configData.connectorToken && configData.apiBaseUrl) {
      for (const { profile, envelope } of results) {
        console.log(`\n  \u{2601}\uFE0F  Uploading ${profile.platform} envelope...`);
        const uploader = new ScholaracleUploader(configData.apiBaseUrl, configData.connectorToken);
        const uploadResult = await uploader.upload(envelope);
        if (uploadResult.success) {
          console.log(`  \u{2705} Upload complete! Run ID: ${uploadResult.runId}`);
        } else {
          console.error(`  \u{274C} Upload failed: ${uploadResult.error}`);
          exitCode = 1;
        }
      }
    }

    // --- Summary ---
    if (failures.length > 0) {
      console.log(`\n  \u{26A0}\uFE0F  ${failures.length} scraper(s) failed:`);
      for (const f of failures) {
        console.log(`     \u{274C} ${f.profile.label}: ${f.error}`);
      }
      exitCode = 1;
    }
    console.log('');
  }

  const totalMs = Date.now() - runStart;
  console.log(`  \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}`);
  console.log(`  Total time: ${fmtDur(totalMs)}`);
  console.log(`  \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\n`);

  if (exitCode !== 0) process.exit(exitCode);
}

main().catch((err) => {
  console.error(`\n  \u{274C} Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});

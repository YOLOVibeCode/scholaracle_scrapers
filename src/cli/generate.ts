import inquirer from 'inquirer';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ScraperConfig, type IStudentProfile, type IStoredCredentials, type IScraperProfile } from '../core/config';
import { registerSource } from '../core/api-client';
import { AiClient } from '../ai/client';
import { runCommand } from './run';

export interface IGenerateOptions {
  readonly configDir?: string;
  /** When set, write generated scraper here instead of src/scrapers/<platform> (for download/export). */
  readonly outputDir?: string;
}

/**
 * Guided wizard: fetch students, collect portal + credentials, generate scraper via AI, save profile.
 */
export async function generateCommand(options?: IGenerateOptions): Promise<void> {
  const configDir = options?.configDir;
  const outputDir = options?.outputDir;
  const config = new ScraperConfig(configDir);
  const configData = config.load();

  console.log('\n  Scholaracle Scraper Generator');
  console.log('  ───────────────────────────\n');

  // Step 1: Prerequisites
  const tokenStatus = config.getTokenStatus();
  if (tokenStatus.status === 'expired' || tokenStatus.status === 'missing') {
    console.log('  No valid connector token. Run: npx scholaracle-scraper setup\n');
    return;
  }
  if (!configData.aiProvider || !configData.aiApiKey) {
    console.log('  No AI provider configured. Run: npx scholaracle-scraper setup\n');
    return;
  }

  // Step 2: Fetch and select students
  let students: IStudentProfile[];
  try {
    students = await config.fetchStudents(configData.apiBaseUrl, configData.connectorToken!);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Could not fetch students: ${msg}`);
    console.log('  Add students in your Scholaracle dashboard, then try again.\n');
    return;
  }
  if (students.length === 0) {
    console.log('  No students found. Add students in your Scholaracle dashboard, then try again.\n');
    return;
  }

  const { studentIds } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'studentIds',
      message: 'Which student(s) will use this scraper?',
      choices: students.map(s => ({ name: `${s.name} (${s.externalId})`, value: s.id })),
      validate: (input: string[]) => input.length > 0 || 'Select at least one student.',
    },
  ]);

  if (!Array.isArray(studentIds) || studentIds.length === 0) return;

  // Step 3: Portal details
  const known = ['canvas', 'aeries', 'skyward'];
  const { platformName, loginUrl, loginMethod } = await inquirer.prompt([
    {
      type: 'input',
      name: 'platformName',
      message: 'What educational platform? (e.g. PowerSchool, Infinite Campus)',
    },
    {
      type: 'input',
      name: 'loginUrl',
      message: 'Portal login URL:',
    },
    {
      type: 'list',
      name: 'loginMethod',
      message: 'Login method:',
      choices: [
        { name: 'Email + password', value: 'email_password' },
        { name: 'Google SSO', value: 'google_sso' },
        { name: 'Clever SSO', value: 'clever_sso' },
        { name: 'Other SSO', value: 'other_sso' },
      ],
    },
  ]);

  const platformSlug = (platformName as string).toLowerCase().replace(/\s+/g, '-');
  if (known.includes(platformSlug)) {
    const { proceed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'proceed',
      message: `"${platformName}" has a reference scraper. Generate a custom one anyway?`,
      default: false,
    }]);
    if (!proceed) return;
  }

  // Step 4: Credentials
  const existingCreds = config.getCredentials().filter(
    c => c.baseUrl === (loginUrl as string).replace(/\/$/, '')
  );
  let credentialsId: string;
  let credentialsLabel: string;

  if (existingCreds.length > 0) {
    const credsAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useExistingCredentials',
        message: 'Use saved credentials for this URL?',
        default: true,
      },
      {
        type: 'list',
        name: 'selectedCredsId',
        message: 'Which saved credentials?',
        choices: existingCreds.map(c => ({ name: c.label, value: c.id })),
        when: (ans: { useExistingCredentials?: boolean }) => ans.useExistingCredentials === true,
      },
    ]) as { useExistingCredentials?: boolean; selectedCredsId?: string };
    if (credsAnswers.useExistingCredentials && credsAnswers.selectedCredsId) {
      credentialsId = credsAnswers.selectedCredsId;
      credentialsLabel = existingCreds.find(c => c.id === credsAnswers.selectedCredsId)!.label;
    } else {
      const created = await promptAndStoreCredentials(config, loginUrl as string, loginMethod as string);
      credentialsId = created.id;
      credentialsLabel = created.label;
    }
  } else {
    const created = await promptAndStoreCredentials(config, loginUrl as string, loginMethod as string);
    credentialsId = created.id;
    credentialsLabel = created.label;
  }

  // Step 5: Data types and notes
  const { dataTypes, notes } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'dataTypes',
      message: 'What data to scrape?',
      choices: [
        { name: 'Grades', value: 'grades', checked: true },
        { name: 'Assignments', value: 'assignments', checked: true },
        { name: 'Attendance', value: 'attendance', checked: true },
        { name: 'Messages / Announcements', value: 'messages', checked: true },
        { name: 'Documents / Files', value: 'documents', checked: true },
        { name: 'Teacher info', value: 'teachers', checked: true },
        { name: 'Schedule', value: 'schedule' },
        { name: 'Calendar events', value: 'events' },
      ],
    },
    {
      type: 'input',
      name: 'notes',
      message: 'Special notes? (e.g. popups, CAPTCHA)',
      default: '',
    },
  ]);

  const dataTypesList = Array.isArray(dataTypes) ? dataTypes as string[] : [];
  const notesStr = typeof notes === 'string' ? notes : '';

  // Step 6: AI generation
  const userPrompt = `Create a scraper for "${platformName}".
Login URL: ${loginUrl}
Login method: ${loginMethod}
Data to scrape: ${dataTypesList.join(', ')}
${notesStr ? `Notes: ${notesStr}` : ''}
Platform directory name: ${platformSlug}
Students: ${studentIds.length}`;

  console.log('\n  Generating scraper with AI...');
  console.log(`  Using ${configData.aiProvider}...\n`);

  let response: string;
  try {
    const aiClient = new AiClient(configData.aiProvider, configData.aiApiKey!);
    response = await aiClient.generate(userPrompt);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  ✗ Generation failed: ${msg}`);
    console.log('  Try prompts/generate-scraper.md with your AI tool.\n');
    return;
  }

  const files = parseGeneratedFiles(response, platformSlug);
  if (files.length === 0) {
    console.log('  ⚠ AI did not produce parseable files. Saving raw response to output/ai-generate-response.txt');
    mkdirSync('output', { recursive: true });
    writeFileSync('output/ai-generate-response.txt', response, 'utf-8');
    return;
  }

  const scrapersRoot = outputDir
    ? outputDir
    : configDir
      ? join(configDir, 'src', 'scrapers')
      : join(process.cwd(), 'src', 'scrapers');
  const scraperDir = join(scrapersRoot, platformSlug);
  mkdirSync(scraperDir, { recursive: true });
  for (const file of files) {
    writeFileSync(join(scraperDir, file.name), file.content, 'utf-8');
    console.log(`  ✓ Created ${join(scraperDir, file.name)}`);
  }
  if (outputDir) {
    console.log(`\n  ✓ Custom scraper written to: ${scraperDir}`);
    console.log('  Copy this folder into your runner\'s src/scrapers/ to use it with: npx scholaracle-scraper run ' + platformSlug);
  }

  // Step 7: Register source on server and save profile
  const sourceId = randomUUID();
  const metadataPath = join(scraperDir, 'metadata.json');
  let adapterId = `com.custom.${platformSlug}`;
  let displayName = platformName as string;
  if (existsSync(metadataPath)) {
    try {
      const raw = readFileSync(metadataPath, 'utf-8');
      const meta = JSON.parse(raw) as { id?: string; name?: string };
      if (meta.id) adapterId = meta.id;
      if (meta.name) displayName = meta.name;
    } catch {
      // keep defaults
    }
  }

  try {
    await registerSource(configData.apiBaseUrl, configData.connectorToken!, {
      sourceId,
      provider: platformSlug,
      adapterId,
      displayName,
      portalBaseUrl: (loginUrl as string).replace(/\/$/, '') || undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Could not register source on server: ${msg}. You can run the scraper anyway.`);
  }

  const profile: IScraperProfile = {
    id: randomUUID(),
    platform: platformSlug,
    label: `${credentialsLabel} (${platformSlug})`,
    credentialsId,
    sourceId,
    studentIds: [...studentIds],
    dataTypes: dataTypesList,
    createdAt: new Date().toISOString(),
  };
  config.addScraperProfile(profile);

  console.log(`\n  ✓ Scraper saved. Profile: ${profile.label}`);
  console.log(`  Students: ${studentIds.length}`);

  // Step 8: Run now? (only when scraper was written to default location, not --output-dir)
  if (!outputDir) {
    const { runNow } = await inquirer.prompt([{
      type: 'confirm',
      name: 'runNow',
      message: 'Run this scraper now?',
      default: false,
    }]);
    if (runNow) {
      await runCommand(platformSlug, {
        profileId: profile.id,
        configDir,
        upload: true,
      });
      return;
    }
  }
  console.log(`\n  Run later: npx scholaracle-scraper run ${platformSlug}`);
  console.log(`  Validate only: npx scholaracle-scraper validate ${platformSlug}\n`);
}

async function promptAndStoreCredentials(
  config: ScraperConfig,
  loginUrl: string,
  loginMethod: string
): Promise<{ id: string; label: string }> {
  const { username, password, credentialsLabel } = await inquirer.prompt([
    { type: 'input', name: 'username', message: 'Username/Email:' },
    { type: 'password', name: 'password', message: 'Password:', mask: '*' },
    { type: 'input', name: 'credentialsLabel', message: 'Label for these credentials (e.g. Lincoln Canvas):', default: new URL(loginUrl).hostname },
  ]);
  const id = randomUUID();
  const creds: IStoredCredentials = {
    id,
    label: credentialsLabel as string,
    baseUrl: loginUrl.replace(/\/$/, ''),
    loginMethod,
    username: username as string,
    password: password as string,
  };
  config.addCredentials(creds);
  console.log('  ✓ Credentials stored locally (not sent to Scholaracle).');
  return { id, label: creds.label };
}

interface IGeneratedFile {
  name: string;
  content: string;
}

function parseGeneratedFiles(response: string, platform: string): IGeneratedFile[] {
  const files: IGeneratedFile[] = [];
  const sections = response.split(/---\s*(.+?)\s*---/);
  for (let i = 1; i < sections.length; i += 2) {
    let fileName = sections[i]?.trim() ?? '';
    const content = sections[i + 1]?.trim() ?? '';
    if (!fileName || !content) continue;
    if (fileName.includes('metadata')) fileName = 'metadata.json';
    else if (fileName.includes('transformer')) fileName = `${platform}-transformer.ts`;
    else if (fileName.includes('scraper')) fileName = `${platform}-scraper.ts`;
    const cleaned = content.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
    files.push({ name: fileName, content: cleaned });
  }
  return files;
}

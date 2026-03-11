import inquirer from 'inquirer';
import axios from 'axios';
import open from 'open';
import { ScraperConfig } from '../core/config';

/** Derive web app URL from API URL so we can open the activate page. */
function webAppUrlFromApi(apiBaseUrl: string): string {
  const u = apiBaseUrl.replace(/\/$/, '');
  if (u.includes('api.scholarmancy.com')) return 'https://scholarmancy.com';
  if (u.includes('localhost') || u.includes('127.0.0.1')) {
    const match = u.match(/:(\d+)/);
    const port = match ? match[1] : '2800';
    return `http://localhost:${port === '2801' ? '2800' : port}`;
  }
  return u.replace(/^https?:\/\/api\./, 'https://').replace(/\/api\/?$/, '') || u;
}

export async function setupCommand(): Promise<void> {
  console.log('\n  Scholaracle Scraper Setup');
  console.log('  ────────────────────────\n');

  const config = new ScraperConfig();
  const existing = config.load();

  // Step 1: API URL
  const { apiBaseUrl } = await inquirer.prompt([{
    type: 'input',
    name: 'apiBaseUrl',
    message: 'Scholaracle API URL:',
    default: existing.apiBaseUrl || 'https://api.scholarmancy.com',
  }]);

  // Step 2: Connector token (device auth or pre-baked)
  const tokenStatus = config.getTokenStatus();
  let connectorToken = existing.connectorToken;

  if (tokenStatus.status === 'active') {
    const { reauth } = await inquirer.prompt([{
      type: 'confirm',
      name: 'reauth',
      message: `You have an active token (expires in ${tokenStatus.daysRemaining} days). Re-authenticate?`,
      default: false,
    }]);
    if (!reauth) {
      console.log('  ✓ Keeping existing token\n');
    } else {
      connectorToken = await runDeviceAuth(apiBaseUrl);
    }
  } else if (tokenStatus.status === 'expired' || tokenStatus.status === 'missing') {
    const { method } = await inquirer.prompt([{
      type: 'list',
      name: 'method',
      message: 'How do you want to authenticate?',
      choices: [
        { name: 'Paste a connector token (from dashboard)', value: 'paste' },
        { name: 'Device auth flow (generates a code to approve on dashboard)', value: 'device' },
      ],
    }]);

    if (method === 'paste') {
      const { token } = await inquirer.prompt([{
        type: 'input',
        name: 'token',
        message: 'Paste your connector token:',
      }]);
      connectorToken = token;
    } else {
      connectorToken = await runDeviceAuth(apiBaseUrl);
    }
  }

  // Step 3: AI provider (optional)
  const { setupAi } = await inquirer.prompt([{
    type: 'confirm',
    name: 'setupAi',
    message: 'Set up AI-powered scraper generation? (recommended)',
    default: true,
  }]);

  let aiProvider: 'openai' | 'anthropic' | 'gemini' | undefined;
  let aiApiKey: string | undefined;

  if (setupAi) {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'aiProvider',
        message: 'Which AI provider?',
        choices: [
          { name: 'OpenAI (ChatGPT)', value: 'openai' },
          { name: 'Anthropic (Claude)', value: 'anthropic' },
          { name: 'Google (Gemini)', value: 'gemini' },
        ],
      },
      {
        type: 'input',
        name: 'aiApiKey',
        message: 'Enter your AI API key:',
      },
    ]);
    aiProvider = answers.aiProvider;
    aiApiKey = answers.aiApiKey;
  }

  // Save config
  config.save({
    apiBaseUrl,
    connectorToken,
    aiProvider,
    aiApiKey,
  });

  console.log('\n  ✓ Configuration saved to ~/.scholaracle-scraper/config.json');
  console.log('\n  Next steps:');
  console.log('    npx scholaracle-scraper run       → Run a scraper');
  console.log('    npx scholaracle-scraper generate   → Create a scraper for a new platform');
  console.log('    npx scholaracle-scraper schedule   → Set up automatic runs');
  console.log('');
}

async function runDeviceAuth(apiBaseUrl: string): Promise<string> {
  console.log('\n  Starting device authentication...');

  try {
    const startRes = await axios.post(`${apiBaseUrl}/api/ingest/v1/device/start`, {});
    const { deviceCode, userCode } = startRes.data;

    const webBase = webAppUrlFromApi(apiBaseUrl);
    const activateUrl = `${webBase.replace(/\/$/, '')}/connector/activate?code=${encodeURIComponent(userCode)}`;

    console.log(`\n  ┌──────────────────────────────────────┐`);
    console.log(`  │  Your activation code: ${userCode}      │`);
    console.log(`  └──────────────────────────────────────┘`);
    console.log('\n  Opening your browser to approve this device…');
    await open(activateUrl).catch(() => {
      console.log('  (Could not open browser. Go to:', activateUrl, ')');
    });
    console.log('  Log in if needed, then click "Approve device". Waiting…\n');

    for (let i = 0; i < 150; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await axios.post(`${apiBaseUrl}/api/ingest/v1/device/poll`, { deviceCode });
      if (pollRes.data.status === 'approved' && pollRes.data.connectorToken) {
        console.log('  ✓ Approved! Connector token saved.\n');
        return pollRes.data.connectorToken;
      }
      if (i % 5 === 0) process.stdout.write('.');
    }

    throw new Error('Device auth timed out after 5 minutes');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Device auth failed: ${msg}`);
    throw err;
  }
}

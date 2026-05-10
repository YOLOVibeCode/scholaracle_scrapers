/**
 * Example: Using Noctusoft relay for email/SMS notifications.
 *
 * Usage:
 *   SSDN_API_KEY=your-key npx ts-node --transpile-only examples/noctusoft-example.ts
 *
 * On Tailscale (100.64.8.0/16):
 *   npx ts-node --transpile-only examples/noctusoft-example.ts
 */

import { NoctusoftClient, ScraperNotifier } from '../src/index';
import { getEnv } from '../src/core/env';

async function main(): Promise<void> {
  const apiKey = getEnv('SSDN_API_KEY');

  console.log('\n  ── Noctusoft API Relay Example ──\n');
  console.log(`  API Key: ${apiKey ? '✓ set' : '✗ not set (using Tailscale)'}\n`);

  // Example 1: Direct email via NoctusoftClient
  const client = new NoctusoftClient(apiKey);

  try {
    await client.sendEmail({
      to: 'test@example.com',
      from: 'noreply@apirelay.us.noctusoft.com',
      subject: 'Test Email from Scholaracle Scraper',
      text: 'This is a test email sent via Noctusoft relay.',
    });
    console.log('  ✓ Email sent successfully\n');
  } catch (err) {
    console.error('  ✗ Email failed:', err instanceof Error ? err.message : String(err));
  }

  // Example 2: Scraper notifications via ScraperNotifier
  const notifier = new ScraperNotifier({
    apiKey,
    notifyEmail: 'admin@example.com',
    notifySms: '+15551234567',
    fromEmail: 'noreply@apirelay.us.noctusoft.com',
  });

  console.log('  ── Notification Examples ──\n');

  // Auth failure notification
  await notifier.notifyAuthFailure({
    scraper: 'canvas',
    student: 'Ava Lewis',
    message: 'Invalid credentials',
  });
  console.log('  ✓ Auth failure notification sent\n');

  // Scraper complete notification
  await notifier.notifyScraperComplete({
    scraper: 'canvas',
    student: 'Ava Lewis',
    opsCount: 142,
    durationMs: 15000,
  });
  console.log('  ✓ Scraper complete notification sent\n');

  // Missing assignments SMS
  await notifier.notifyMissingAssignments({
    student: 'Ava Lewis',
    count: 3,
    courses: ['Math', 'Science', 'History'],
  });
  console.log('  ✓ Missing assignments SMS sent\n');

  console.log('  ── Integration Notes ──\n');
  console.log('  • On Tailscale (100.64.8.0/16): No API key needed');
  console.log('  • External IPs: Set SSDN_API_KEY env var');
  console.log('  • Railway: Static IPs auto-bind within 24h');
  console.log('  • Vercel: Use OIDC with SGXXX relay (no secret needed)\n');
}

main();

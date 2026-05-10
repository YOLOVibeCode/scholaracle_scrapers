/**
 * Production test: Verify Noctusoft integration on Railway
 *
 * This script tests the deployed production environment to ensure
 * email/SMS notifications work correctly with the NOCTUSOFT_API_KEY.
 *
 * Usage:
 *   npx ts-node --transpile-only test-production-noctusoft.ts
 */

import { NoctusoftClient, ScraperNotifier } from './src/index';

async function testEmailRelay(): Promise<boolean> {
  console.log('\n  ── Testing Email Relay ──\n');
  
  const apiKey = process.env.NOCTUSOFT_API_KEY;
  if (!apiKey) {
    console.error('  ✗ NOCTUSOFT_API_KEY not set');
    return false;
  }

  const client = new NoctusoftClient(apiKey);

  try {
    await client.sendEmail({
      to: 'test@example.com',
      from: 'noreply@apirelay.us.noctusoft.com',
      subject: '[Scholaracle Test] Production Email Relay',
      text: `This is a test email from Scholaracle production environment.

Timestamp: ${new Date().toISOString()}
Environment: Railway Production
API Key: ${apiKey.substring(0, 20)}...

If you receive this, the Noctusoft email relay is working correctly!`,
    });
    
    console.log('  ✅ Email sent successfully via Noctusoft relay');
    return true;
  } catch (err) {
    console.error('  ✗ Email failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function testSmsRelay(): Promise<boolean> {
  console.log('\n  ── Testing SMS Relay ──\n');
  
  const apiKey = process.env.NOCTUSOFT_API_KEY;
  if (!apiKey) {
    console.error('  ✗ NOCTUSOFT_API_KEY not set');
    return false;
  }

  const client = new NoctusoftClient(apiKey);

  try {
    const result = await client.sendSms({
      to: '+15005550006', // Twilio test number
      body: '[Scholaracle Test] Production SMS relay working!',
    });
    
    console.log(`  ✅ SMS sent successfully via Noctusoft relay (SID: ${result.sid})`);
    return true;
  } catch (err) {
    console.error('  ✗ SMS failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function testScraperNotifier(): Promise<boolean> {
  console.log('\n  ── Testing ScraperNotifier ──\n');
  
  const apiKey = process.env.NOCTUSOFT_API_KEY;
  if (!apiKey) {
    console.error('  ✗ NOCTUSOFT_API_KEY not set');
    return false;
  }

  const notifier = new ScraperNotifier({
    apiKey,
    notifyEmail: 'admin@example.com',
    notifySms: '+15005550006',
    fromEmail: 'noreply@apirelay.us.noctusoft.com',
  });

  try {
    // Test auth failure notification
    await notifier.notifyAuthFailure({
      scraper: 'canvas',
      student: 'Test Student',
      message: 'Production test notification - ignore',
    });
    
    console.log('  ✅ Auth failure notification sent');

    // Test missing assignments SMS
    await notifier.notifyMissingAssignments({
      student: 'Test Student',
      count: 2,
      courses: ['Math', 'Science'],
    });
    
    console.log('  ✅ Missing assignments SMS sent');
    
    return true;
  } catch (err) {
    console.error('  ✗ Notifier failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function main(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Scholaracle Production Test — Noctusoft Integration      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const apiKey = process.env.NOCTUSOFT_API_KEY;
  console.log(`\n  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  API Key: ${apiKey ? '✓ set' : '✗ NOT SET'}`);
  console.log(`  Railway: ${process.env.RAILWAY_ENVIRONMENT || 'not detected'}`);

  if (!apiKey) {
    console.error('\n  ✗ NOCTUSOFT_API_KEY environment variable is not set!');
    console.error('    Set it with: export NOCTUSOFT_API_KEY=nsins_dk_...');
    process.exit(1);
  }

  const results = {
    email: await testEmailRelay(),
    sms: await testSmsRelay(),
    notifier: await testScraperNotifier(),
  };

  console.log('\n  ── Test Results ──\n');
  console.log(`  Email Relay:        ${results.email ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  SMS Relay:          ${results.sms ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Scraper Notifier:   ${results.notifier ? '✅ PASS' : '❌ FAIL'}`);

  const allPassed = results.email && results.sms && results.notifier;
  
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  if (allPassed) {
    console.log('║  ✅ ALL TESTS PASSED — Production is ready!               ║');
  } else {
    console.log('║  ❌ SOME TESTS FAILED — Check errors above                ║');
  }
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  process.exit(allPassed ? 0 : 1);
}

main();

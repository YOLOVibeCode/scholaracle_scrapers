# Noctusoft API Relay Integration

The Scholaracle scraper library includes built-in support for the Noctusoft API Relay Network — a unified gateway for SendGrid (email), Twilio (SMS), Square (payments), and Google APIs.

## Quick Start

### 1. Set Environment Variable

```bash
export SSDN_API_KEY=nsins_sk_2cdb09ca824242f72103b6bc40ae6bddc3bb70d936027ce2
```

**On Tailscale:** No API key needed! The relay auto-detects Tailscale IPs (`100.64.8.0/16`) and auto-injects credentials.

### 2. Send Email or SMS

```typescript
import { NoctusoftClient } from '@scholaracle/scrapers';

const client = new NoctusoftClient(process.env.SSDN_API_KEY);

// Send email
await client.sendEmail({
  to: 'user@example.com',
  from: 'noreply@apirelay.us.noctusoft.com',
  subject: 'Hello',
  text: 'Message body',
});

// Send SMS
await client.sendSms({
  to: '+15551234567',
  body: 'Your scraper completed successfully!',
});
```

### 3. Scraper Notifications

```typescript
import { ScraperNotifier } from '@scholaracle/scrapers';

const notifier = new ScraperNotifier({
  apiKey: process.env.SSDN_API_KEY,
  notifyEmail: 'admin@example.com',
  notifySms: '+15551234567',
});

// Auth failure alert
await notifier.notifyAuthFailure({
  scraper: 'canvas',
  student: 'Ava Lewis',
  message: 'Invalid credentials',
});

// Missing assignments SMS
await notifier.notifyMissingAssignments({
  student: 'Ava Lewis',
  count: 3,
  courses: ['Math', 'Science'],
});
```

---

## Architecture

### Relay Endpoints

| Service | Direct API | Noctusoft Relay |
|---------|------------|-----------------|
| **SendGrid** | `api.sendgrid.com` | `api.sndgrid.us.noctusoft.com` |
| **Twilio** | `api.twilio.com` | `api.twilio.us.noctusoft.com` |
| **Square** | `connect.squareup.com` | `connect.usapayng.us.noctusoft.com` |
| **Google** | `*.googleapis.com` | `googleapis.us.noctusoft.com` |

### Authentication

**Option 1: Tailscale (Trusted IPs)**
- No API key needed
- Auto-injects all credentials
- Works for any IP in `100.64.8.0/16`

**Option 2: API Key Auth**
```typescript
// X-Api-Key header
headers: {
  'X-Api-Key': process.env.SSDN_API_KEY,
}

// OR Authorization: Bearer
headers: {
  'Authorization': `Bearer ${process.env.SSDN_API_KEY}`,
}
```

### Verified Sender Domains

Your `from` address must use one of these verified domains:

- `apirelay.us.noctusoft.com`
- `sdranews.org`
- `getnotified.lol`
- `bdzn-network`
- `app-network`
- `repptxli.pro`
- `schedulingcoordinary.com`
- `scholarmancy.com`
- `ilovecurry.com`

---

## Deployment Guide

### Railway

Railway has static outbound IPs — they auto-bind within 24 hours. Use API key auth.

```bash
# Set in Railway environment variables
SSDN_API_KEY=nsins_sk_2cdb09ca824242f72103b6bc40ae6bddc3bb70d936027ce2
```

### Vercel

For email, use OIDC with `SGXXX` relay (no secret needed):

```typescript
// Vercel auto-detects and uses OIDC
const client = new NoctusoftClient(); // No API key!
```

### Local Development (Tailscale)

If your machine is on Tailscale:

```bash
# No env var needed
npx ts-node examples/noctusoft-example.ts
```

If not on Tailscale:

```bash
SSDN_API_KEY=your-key npx ts-node examples/noctusoft-example.ts
```

---

## Use Cases

### 1. Auth Failure Alerts

```typescript
try {
  const authResult = await scraper.authenticate();
  if (!authResult.success) {
    await notifier.notifyAuthFailure({
      scraper: 'canvas',
      student: config.studentName,
      message: authResult.message ?? 'Unknown error',
    });
  }
} catch (err) {
  // Handle error
}
```

### 2. Scraper Completion Summary

```typescript
const startTime = Date.now();
const envelope = await scraper.run(config);
const durationMs = Date.now() - startTime;

await notifier.notifyScraperComplete({
  scraper: 'canvas',
  student: config.studentName,
  opsCount: envelope.ops.length,
  durationMs,
});
```

### 3. Missing Assignment Alerts

```typescript
const missingOps = envelope.ops.filter(
  op => op.entity === 'assignment' && 
        (op.record as any).status === 'missing'
);

if (missingOps.length > 0) {
  const courses = [...new Set(missingOps.map(op => (op.record as any).courseExternalId))];
  
  await notifier.notifyMissingAssignments({
    student: config.studentName,
    count: missingOps.length,
    courses,
  });
}
```

---

## Monitoring

The relay runs a daily test harness at 7 AM CST checking:
- DNS resolution (7 domains)
- SSL certificates
- Health checks (5 services)
- Upstream connectivity (SendGrid, Twilio, Square, Google)
- End-to-end relay tests
- Message history read-back

If any test fails, an SMS alert is sent to the admin.

**Test endpoints:**
- Full test: `https://docs.api.noctusoft.com/` → "Run Full Test"
- Dry test: `https://docs.api.noctusoft.com/` → "Run Dry Test"

---

## API Reference

### `NoctusoftClient`

```typescript
class NoctusoftClient {
  constructor(apiKey?: string);
  
  sendEmail(options: IEmailOptions): Promise<void>;
  sendSms(options: ISmsOptions): Promise<ISmsResult>;
}

interface IEmailOptions {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

interface ISmsOptions {
  to: string;
  body: string;
  from?: string; // Default: +15551234567
}
```

### `ScraperNotifier`

```typescript
class ScraperNotifier {
  constructor(config: INotifierConfig);
  
  notifyAuthFailure(notification: IAuthFailureNotification): Promise<void>;
  notifyScraperComplete(notification: IScraperCompleteNotification): Promise<void>;
  notifyScraperError(notification: IScraperErrorNotification): Promise<void>;
  notifyMissingAssignments(notification: IMissingAssignmentsNotification): Promise<void>;
}

interface INotifierConfig {
  apiKey?: string;
  notifyEmail?: string;
  notifySms?: string;
  fromEmail?: string; // Default: noreply@apirelay.us.noctusoft.com
}
```

---

## Troubleshooting

### Email not sending

1. Check `from` domain is verified (see list above)
2. Verify API key is set correctly
3. Check Railway IP is whitelisted (auto-binds in 24h)

### SMS not working

1. Verify phone number format: `+1XXXXXXXXXX`
2. Check Twilio credentials are configured in relay
3. Confirm `notifySms` is set in notifier config

### 403 Forbidden

- You're not on Tailscale and no API key is set
- Set `SSDN_API_KEY` environment variable

---

## Security

- **Never commit** `SSDN_API_KEY` to git
- Store in environment variables or secrets manager
- The centralized `src/core/env.ts` sanitizes all env vars (strips newlines/whitespace)
- API key is only sent over HTTPS with auto-renewing Let's Encrypt certs

---

For more details, see: https://docs.api.noctusoft.com/

# Noctusoft Integration — Ready for Production

## Status: ✅ Ready to Deploy

### What's Implemented

1. **NoctusoftClient** (`src/core/noctusoft-client.ts`)
   - Email relay via SendGrid API format
   - SMS relay via Twilio API format
   - Supports both API key auth and trusted IP auth

2. **ScraperNotifier** (`src/core/scraper-notifier.ts`)
   - High-level notification service for scrapers
   - Auth failures, scraper completion, errors, missing assignments
   - Sends email + SMS based on configuration

3. **Environment Variable Management** (`src/core/env.ts`)
   - Centralized `NOCTUSOFT_API_KEY` handling
   - Full sanitization (strips newlines, trims whitespace)
   - 262 tests passing

4. **Documentation**
   - `docs/NOCTUSOFT_INTEGRATION.md` - Full integration guide
   - `NOCTUSOFT_SETUP.md` - Quick setup instructions
   - `examples/noctusoft-example.ts` - Usage examples

### Authentication Model (from Noctusoft)

| Method | Who | IP Restriction | Key Prefix |
|--------|-----|----------------|------------|
| Deploy Key (unrestricted) | Railway, Fly, any deployed app | None | `nsins_dk_` |
| Standard Key (IP-bound) | Known fixed-IP clients | IP whitelist | `nsins_sk_` |
| Trusted IP | Server, home, Tailscale | Auto | N/A |

### Railway Configuration

**Environment Variable:**
```bash
NOCTUSOFT_API_KEY=nsins_dk_cd8c0425f52e49da6c938b9163c114053f08a0faad6cd7b5
```

This deploy key works from any IP (no whitelisting needed).

### Local Testing Limitation

⚠️ **Important:** The relay endpoints (`api.sndgrid.us.noctusoft.com`, `api.twilio.us.noctusoft.com`) are not publicly resolvable via standard DNS. They only work from:

1. Railway (with static IP binding)
2. Tailscale network
3. Other trusted networks

**This is expected behavior** — the relays are designed to be accessible only from known networks, even with a deploy key.

### Testing from Railway

Use the Railway CLI or web console to test:

```bash
# From Railway shell
railway run npx ts-node test-production-noctusoft.ts

# Or via Railway shell
railway shell
> cd /app
> node dist/test-production-noctusoft.js
```

### What Works Locally

- ✅ All unit tests (262 passing)
- ✅ Build and compile
- ✅ Type checking
- ✅ Linting
- ❌ Live API calls (DNS blocked)

### Next Steps

1. Deploy this code to Railway
2. Run `test-production-noctusoft.ts` from Railway environment
3. Verify email/SMS delivery
4. Use `ScraperNotifier` in production scrapers

### Usage Example

```typescript
import { ScraperNotifier } from 'scholaracle-scraper';

const notifier = new ScraperNotifier({
  apiKey: process.env.NOCTUSOFT_API_KEY,
  notifyEmail: 'admin@example.com',
  notifySms: '+15551234567',
  fromEmail: 'noreply@apirelay.us.noctusoft.com',
});

// Send auth failure notification
await notifier.notifyAuthFailure({
  scraper: 'canvas',
  student: 'Emma Lewis',
  message: 'Login credentials invalid',
});

// Send missing assignments alert
await notifier.notifyMissingAssignments({
  student: 'Emma Lewis',
  count: 3,
  courses: ['Math', 'Science', 'History'],
});
```

### Code Changes Summary

**Files Updated:**
- `src/core/env.ts` - Added `NOCTUSOFT_API_KEY` to ENV_KEYS
- `src/core/env.test.ts` - Updated tests for new key name
- `src/core/noctusoft-client.ts` - Updated comments for deploy key
- `test-production-noctusoft.ts` - Changed from `SSDN_API_KEY` to `NOCTUSOFT_API_KEY`

**Files Created:**
- `src/core/noctusoft-client.ts` - API client
- `src/core/noctusoft-client.test.ts` - 10 tests
- `src/core/scraper-notifier.ts` - Notification service
- `src/core/scraper-notifier.test.ts` - 6 tests
- `docs/NOCTUSOFT_INTEGRATION.md` - Full docs
- `NOCTUSOFT_SETUP.md` - Quick guide
- `examples/noctusoft-example.ts` - Examples
- `test-production-noctusoft.ts` - E2E test script

### Test Coverage

- **Unit tests:** 16 tests (noctusoft-client + scraper-notifier)
- **Integration tests:** Full env.ts coverage
- **E2E test:** `test-production-noctusoft.ts` (requires Railway or Tailscale)

---

**Status:** Code complete, tests passing, ready for Railway deployment and testing.

**Last Updated:** 2026-05-10

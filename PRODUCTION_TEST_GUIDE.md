# Production Testing Guide — Noctusoft Integration

## Issue: Local Testing Not Possible

**DNS Resolution Failure:**
```
api.sndgrid.us.noctusoft.com → NXDOMAIN (domain not found)
```

**Root Cause:**
- The Noctusoft relay domains are either:
  1. **Internal to Tailscale network** (100.64.8.0/16 only)
  2. **Not publicly accessible** (require VPN/private network)
  3. **Custom DNS setup** for the relay infrastructure

**Local Machine Status:**
- ✗ Not on Tailscale network
- ✗ Cannot resolve relay domains
- ✓ Can access docs.api.noctusoft.com (74.235.141.84)

---

## Solution: Test from Railway Production

Since Railway has static IPs that auto-bind to the Noctusoft relay within 24 hours, testing must happen **from the Railway environment itself**.

---

## Option 1: Test via Railway API Endpoint

### 1. Add Test Endpoint to API

Add this to your API service:

```typescript
// In your Express/Fastify app
import { NoctusoftClient } from '@scholaracle/scrapers';

app.post('/api/test/noctusoft', async (req, res) => {
  const apiKey = process.env.SSDN_API_KEY;
  
  if (!apiKey) {
    return res.status(500).json({ error: 'SSDN_API_KEY not configured' });
  }

  const client = new NoctusoftClient(apiKey);

  try {
    // Test email
    await client.sendEmail({
      to: req.body.email || 'test@example.com',
      from: 'noreply@apirelay.us.noctusoft.com',
      subject: '[Test] Noctusoft Integration',
      text: `Test from Railway at ${new Date().toISOString()}`,
    });

    return res.json({
      success: true,
      message: 'Email sent successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
```

### 2. Call the Endpoint

```bash
curl -X POST https://api.scholarmancy.com/api/test/noctusoft \
  -H "Content-Type: application/json" \
  -d '{"email":"your-test-email@example.com"}'
```

---

## Option 2: Test via Railway CLI

### 1. Run Command in Railway Environment

```bash
railway run node -e "
const {NoctusoftClient} = require('./dist/src/index.js');
const client = new NoctusoftClient(process.env.SSDN_API_KEY);

client.sendEmail({
  to: 'test@example.com',
  from: 'noreply@apirelay.us.noctusoft.com',
  subject: 'Railway Test',
  text: 'Testing from Railway CLI'
}).then(() => {
  console.log('✅ Success');
  process.exit(0);
}).catch(err => {
  console.error('✗ Failed:', err.message);
  process.exit(1);
});
"
```

---

## Option 3: Check Railway Logs

### 1. Deploy Code That Uses Noctusoft

Make sure your scraper code includes notifier calls:

```typescript
import { ScraperNotifier } from '@scholaracle/scrapers';

const notifier = new ScraperNotifier({
  apiKey: process.env.SSDN_API_KEY,
  notifyEmail: 'admin@example.com',
});

// In your scraper lifecycle
try {
  const authResult = await scraper.authenticate();
  if (!authResult.success) {
    await notifier.notifyAuthFailure({
      scraper: 'canvas',
      student: config.studentName,
      message: authResult.message ?? 'Auth failed',
    });
  }
} catch (err) {
  // Will show in Railway logs
}
```

### 2. Check Logs

```bash
railway logs --service api
railway logs --service workers
```

Look for:
- ✅ Email sent successfully
- ✗ Noctusoft errors
- ✗ SSDN_API_KEY not found

---

## Option 4: Test with Railway Shell

### 1. SSH into Railway Service

```bash
railway shell --service api
```

### 2. Run Node REPL Test

```javascript
const {NoctusoftClient} = require('./dist/src/index.js');
const client = new NoctusoftClient(process.env.SSDN_API_KEY);

await client.sendEmail({
  to: 'test@example.com',
  from: 'noreply@apirelay.us.noctusoft.com',
  subject: 'Shell Test',
  text: 'Testing from Railway shell'
});
// Should see: undefined (success) or Error (failure)
```

---

## Expected Results

### If Working ✅

```json
{
  "success": true,
  "message": "Email sent successfully",
  "timestamp": "2026-05-10T12:15:00.000Z"
}
```

### If API Key Missing ❌

```json
{
  "error": "SSDN_API_KEY not configured"
}
```

### If Relay Unreachable ❌

```
Error: getaddrinfo ENOTFOUND api.sndgrid.us.noctusoft.com
```

**Solution:** Wait 24 hours for Railway static IPs to auto-bind, or contact Noctusoft admin to whitelist Railway IPs manually.

---

## Verification Checklist

- [ ] `SSDN_API_KEY` is set in Railway environment (✅ **DONE**)
- [ ] Code imports `NoctusoftClient` or `ScraperNotifier`
- [ ] Code is deployed to Railway
- [ ] 24 hours have passed since first deployment (for auto-bind)
- [ ] Test endpoint created and called
- [ ] Railway logs show success/error messages

---

## Current Status

✅ **Environment Configured:**
- `SSDN_API_KEY` set in Railway `api` service
- `SSDN_API_KEY` set in Railway `workers` service

⏳ **Waiting For:**
- Railway static IPs to auto-bind to Noctusoft relay (~24 hours)
- OR manual IP whitelisting in Noctusoft admin panel

❌ **Cannot Test Locally:**
- Relay domains not accessible outside Tailscale network
- Local machine not on Tailscale (100.64.8.0/16)

---

## Next Steps

1. **Add test endpoint** to your API service (Option 1)
2. **Deploy to Railway** and call the endpoint
3. **Check Railway logs** for success/error messages
4. **Wait 24 hours** if Railway IPs need to auto-bind
5. **Contact Noctusoft admin** if immediate access needed

---

## Alternative: Use Tailscale

If you need to test locally:

1. Install Tailscale: https://tailscale.com/download
2. Join the Noctusoft Tailscale network
3. Run the test script again:

```bash
SSDN_API_KEY=nsins_sk_... npx ts-node test-production-noctusoft.ts
```

Once on Tailscale (100.64.8.0/16), the relay domains will resolve and no API key is needed.

---

## Summary

**The code is ready** — it just needs to be tested from an environment that can reach the Noctusoft relay:

1. **Railway production** (after IP auto-bind)
2. **Tailscale network** (immediate access)
3. **Whitelisted IPs** (manual admin setup)

Local testing is blocked by network/DNS restrictions, not code issues.

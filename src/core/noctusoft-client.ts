/**
 * Noctusoft API Relay client for email (SendGrid) and SMS (Twilio).
 * Auto-detects Tailscale trusted IPs (no API key needed) or uses explicit API key auth.
 */

export interface IEmailOptions {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly replyTo?: string;
}

export interface ISmsOptions {
  readonly to: string;
  readonly body: string;
  readonly from?: string;
}

export interface ISmsResult {
  readonly sid: string;
}

/**
 * Noctusoft relay client.
 * When running on Tailscale (100.64.8.0/16) or trusted IPs, no API key is needed.
 * Otherwise, pass NOCTUSOFT_API_KEY (deploy key or standard key) for authentication.
 */
export class NoctusoftClient {
  private readonly apiKey?: string;
  private readonly emailBaseUrl = 'https://api.sendgrid.noctusoft.com';
  private readonly smsBaseUrl = 'https://api.twilio.noctusoft.com';

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  /**
   * Send email via SendGrid relay (drop-in replacement for api.sendgrid.com).
   */
  async sendEmail(options: IEmailOptions): Promise<void> {
    const { to, from, subject, text, html, replyTo } = options;

    const personalizations = [
      {
        to: [{ email: to }],
        subject,
      },
    ];

    const content = html
      ? [{ type: 'text/html', value: html }]
      : [{ type: 'text/plain', value: text ?? '' }];

    const body: Record<string, unknown> = {
      personalizations,
      from: { email: from },
      content,
    };

    if (replyTo) {
      body.reply_to = { email: replyTo };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
    }

    const res = await fetch(`${this.emailBaseUrl}/v3/mail/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Noctusoft email failed: ${res.status} ${res.statusText}`);
    }
  }

  /**
   * Send SMS via Twilio relay (drop-in replacement for api.twilio.com).
   */
  async sendSms(options: ISmsOptions): Promise<ISmsResult> {
    const { to, body, from = '+15551234567' } = options;

    const params = new URLSearchParams();
    params.append('To', to);
    params.append('From', from);
    params.append('Body', body);

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
    }

    const res = await fetch(
      `${this.smsBaseUrl}/2010-04-01/Accounts/REDACTED/Messages.json`,
      {
        method: 'POST',
        headers,
        body: params.toString(),
      },
    );

    if (!res.ok) {
      throw new Error(`Noctusoft SMS failed: ${res.status} ${res.statusText}`);
    }

    return (await res.json()) as ISmsResult;
  }
}

/**
 * Notification service for scraper lifecycle events.
 * Uses Noctusoft relay for email (SendGrid) and SMS (Twilio).
 */

import { NoctusoftClient } from './noctusoft-client';

export interface INotifierConfig {
  readonly apiKey?: string;
  readonly notifyEmail?: string;
  readonly notifySms?: string;
  readonly fromEmail?: string;
}

export interface IAuthFailureNotification {
  readonly scraper: string;
  readonly student: string;
  readonly message: string;
}

export interface IScraperCompleteNotification {
  readonly scraper: string;
  readonly student: string;
  readonly opsCount: number;
  readonly durationMs: number;
}

export interface IScraperErrorNotification {
  readonly scraper: string;
  readonly student: string;
  readonly error: Error;
}

export interface IMissingAssignmentsNotification {
  readonly student: string;
  readonly count: number;
  readonly courses: readonly string[];
}

export class ScraperNotifier {
  private readonly client: NoctusoftClient;
  private readonly notifyEmail?: string;
  private readonly notifySms?: string;
  private readonly fromEmail: string;

  constructor(config: INotifierConfig) {
    this.client = new NoctusoftClient(config.apiKey);
    this.notifyEmail = config.notifyEmail;
    this.notifySms = config.notifySms;
    this.fromEmail = config.fromEmail ?? 'noreply@apirelay.us.noctusoft.com';
  }

  async notifyAuthFailure(notification: IAuthFailureNotification): Promise<void> {
    if (!this.notifyEmail) return;

    const { scraper, student, message } = notification;
    await this.client.sendEmail({
      to: this.notifyEmail,
      from: this.fromEmail,
      subject: `🔑 Scraper Auth Failed: ${scraper} (${student})`,
      text: `Authentication failed for ${scraper} scraper.

Student: ${student}
Error: ${message}

This scraper will not run until credentials are updated.`,
    });
  }

  async notifyScraperComplete(notification: IScraperCompleteNotification): Promise<void> {
    if (!this.notifyEmail) return;

    const { scraper, student, opsCount, durationMs } = notification;
    const durationSec = (durationMs / 1000).toFixed(1);

    await this.client.sendEmail({
      to: this.notifyEmail,
      from: this.fromEmail,
      subject: `✓ Scraper Complete: ${scraper} (${student})`,
      text: `Scraper ${scraper} completed successfully.

Student: ${student}
Operations: ${opsCount} ops
Duration: ${durationSec}s`,
    });
  }

  async notifyScraperError(notification: IScraperErrorNotification): Promise<void> {
    if (!this.notifyEmail) return;

    const { scraper, student, error } = notification;
    await this.client.sendEmail({
      to: this.notifyEmail,
      from: this.fromEmail,
      subject: `✗ Scraper Error: ${scraper} (${student})`,
      text: `Scraper ${scraper} encountered an error.

Student: ${student}
Error: ${error.message}

Stack trace:
${error.stack ?? 'No stack trace available'}`,
    });
  }

  async notifyMissingAssignments(notification: IMissingAssignmentsNotification): Promise<void> {
    if (!this.notifySms) return;

    const { student, count, courses } = notification;
    const courseList = courses.slice(0, 3).join(', ');
    const more = courses.length > 3 ? ` +${courses.length - 3} more` : '';

    await this.client.sendSms({
      to: this.notifySms,
      body: `⚠️ ${student}: ${count} missing assignment${count === 1 ? '' : 's'} in ${courseList}${more}`,
    });
  }
}

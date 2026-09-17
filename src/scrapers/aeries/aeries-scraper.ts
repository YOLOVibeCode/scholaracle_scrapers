/**
 * Aeries Parent Portal Browser Scraper
 *
 * Uses Playwright to authenticate into Aeries (email/password, two-step flow)
 * then delegates all extraction to the shared aeries-recipe from @scholaracle/scraper-core.
 */

import { type Browser } from 'playwright';
import { BaseScraper } from '../../core/base-scraper';
import type { ISlcDeltaOp } from '@scholaracle/contracts';
import type { IScraperConfig, IScraperMetadata } from '../../core/scraper-types';
import {
  runAeriesRecipe,
  transformAeriesExtract,
  type IAeriesFullExtract,
} from '@scholaracle/scraper-core';
import { PlaywrightPageDriver } from '../../core/playwright-driver';
import metadata from './metadata.json';

export class AeriesScraper extends BaseScraper {
  private browser: Browser | null = null;
  private driver: PlaywrightPageDriver | null = null;
  private baseUrl = '';

  get metadata(): IScraperMetadata {
    return metadata as IScraperMetadata;
  }

  async initialize(config: IScraperConfig): Promise<void> {
    this.config = config;
    this.baseUrl = config.credentials.baseUrl.replace(/\/$/, '');
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({ headless: config.options?.headless ?? true });
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(config.options?.timeout ?? 20000);
    this.driver = new PlaywrightPageDriver(page);
  }

  async authenticate(): Promise<{ success: boolean; message?: string }> {
    if (!this.driver) return { success: false, message: 'Driver not initialized' };
    const page = this.driver.page;

    try {
      await page.goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 30000 });

      const email = this.config!.credentials.username ?? '';
      const password = this.config!.credentials.password ?? '';

      const emailInput = page.locator('input[placeholder="Email"], input[name*="Email"], #EmailAddress');
      await emailInput.fill(email);

      const nextBtn = page.locator('button:has-text("Next"), input[value="Next"]');
      await nextBtn.click({ timeout: 10000 });
      await page.waitForTimeout(2000);

      const passwordInput = page.locator('input[placeholder="Password"], input[type="password"]');
      await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
      await passwordInput.fill(password);

      const signInBtn = page.locator('button:has-text("Sign In"), input[value="Sign In"]');
      await signInBtn.click({ timeout: 10000 });

      await page.waitForURL('**/Dashboard.aspx', { timeout: 20000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const finalUrl = page.url();
      if (finalUrl.includes('/login') || finalUrl.includes('LoginParent')) {
        return { success: false, message: `Login may have failed. Current URL: ${finalUrl}` };
      }

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  }

  async scrape(): Promise<Record<string, unknown>> {
    if (!this.driver) throw new Error('Driver not initialized');
    const extract = await runAeriesRecipe(this.driver, this.baseUrl);
    return extract as unknown as Record<string, unknown>;
  }

  transform(rawData: Record<string, unknown>): ISlcDeltaOp[] {
    const extract = rawData as unknown as IAeriesFullExtract;
    let filtered = extract;
    if (this.config?.studentName && extract.students.length > 1) {
      const matched = extract.students.filter((s) =>
        s.name.toLowerCase().includes(this.config!.studentName.toLowerCase()),
      );
      filtered = {
        ...extract,
        students: matched.length > 0 ? matched : [extract.students[0]!],
      };
    }
    return transformAeriesExtract(filtered, {
      provider: this.config!.provider,
      adapterId: this.config!.adapterId,
      studentExternalId: this.config!.studentExternalId,
      institutionExternalId: this.config!.institutionExternalId,
    });
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.driver = null;
    }
  }
}

export type { IAeriesFullExtract } from '@scholaracle/scraper-core';

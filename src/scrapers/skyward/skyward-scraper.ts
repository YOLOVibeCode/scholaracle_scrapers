/**
 * Skyward Family Access Browser Scraper
 *
 * Uses Playwright to authenticate into Skyward (username/password or Google SSO,
 * handling the popup-window pattern) then delegates extraction to the shared
 * skyward-recipe from @scholaracle/scraper-core.
 */

import { type Browser, type BrowserContext, type Page } from 'playwright';
import { BaseScraper } from '../../core/base-scraper';
import type { ISlcDeltaOp } from '@scholaracle/contracts';
import type { IScraperConfig, IScraperMetadata } from '../../core/scraper-types';
import {
  runSkywardRecipe,
  transformSkywardExtract,
  type ISkywardFullExtract,
} from '@scholaracle/scraper-core';
import { PlaywrightPageDriver } from '../../core/playwright-driver';
import metadata from './metadata.json';
import { useStrategy, computeFingerprint } from '../../core/strategy-store';

export class SkywardScraper extends BaseScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
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
    this.context = await this.browser.newContext();
    const page = await this.context.newPage();
    page.setDefaultTimeout(config.options?.timeout ?? 20000);
    this.driver = new PlaywrightPageDriver(page);
  }

  async authenticate(): Promise<{ success: boolean; message?: string }> {
    if (!this.driver || !this.context) return { success: false, message: 'Browser not initialized' };
    const page = this.driver.page;

    try {
      await page.goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 20000 });

      await page.locator('select').selectOption({ label: 'Family/Student Access' }).catch(() => {});

      const hasGoogleLogin = await page.locator(
        'input[value="Login with Google"], button:has-text("Login with Google"), #bGoogleLogin, [onclick*="google"]',
      ).count() > 0;

      const loginMethod = this.config!.credentials.loginMethod ?? (hasGoogleLogin ? 'google_sso' : 'direct');

      if (loginMethod === 'google_sso') {
        return this.authenticateViaGoogle(page);
      }

      return this.authenticateViaPassword(page);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  }

  async scrape(): Promise<Record<string, unknown>> {
    if (!this.driver) throw new Error('Driver not initialized');
    const extract = await runSkywardRecipe(this.driver, this.baseUrl);
    return extract as unknown as Record<string, unknown>;
  }

  transform(rawData: Record<string, unknown>): ISlcDeltaOp[] {
    const extract = rawData as unknown as ISkywardFullExtract;
    return transformSkywardExtract(extract, {
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
      this.context = null;
      this.driver = null;
    }
  }

  private async authenticateViaPassword(page: Page): Promise<{ success: boolean; message?: string }> {
    if (!this.context) return { success: false, message: 'Browser not initialized' };

    await page.locator('input[name="login"], #login').fill(this.config!.credentials.username ?? '');
    await page.locator('input[name="password"], #password').fill(this.config!.credentials.password ?? '');

    let popup: Page | null = null;
    this.context.on('page', (p: Page) => { popup = p; });

    await page.locator('#bLogin').click({ timeout: 10000 });
    await page.waitForTimeout(5000);

    if (popup !== null) {
      await (popup as Page).waitForLoadState('networkidle', { timeout: 15000 });
      this.driver!.setPage(popup as Page);
    } else {
      await page.waitForLoadState('networkidle');
    }

    const finalUrl = this.driver!.url();
    if (finalUrl.includes('seplog')) {
      return { success: false, message: `Login may have failed. Current URL: ${finalUrl}` };
    }

    return { success: true };
  }

  private async authenticateViaGoogle(page: Page): Promise<{ success: boolean; message?: string }> {
    const googleBtn = page.locator(
      'input[value="Login with Google"], button:has-text("Login with Google"), #bGoogleLogin, [onclick*="google"]',
    ).first();
    await googleBtn.click({ timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    if (page.url().includes('accounts.google.com')) {
      await page.waitForSelector('input[type="email"], input[name="identifier"]', { timeout: 15000 });
      await page.fill('input[type="email"], input[name="identifier"]', this.config!.credentials.username ?? '');
      await page.click('button:has-text("Next"), #identifierNext button');

      await page.waitForSelector('input[type="password"], input[name="Passwd"]', { timeout: 10000 });
      await page.fill('input[type="password"], input[name="Passwd"]', this.config!.credentials.password ?? '');
      await page.click('button:has-text("Next"), #passwordNext button');

      await page.waitForURL((url) => !url.hostname.includes('accounts.google.com'), { timeout: 30000 });
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const finalUrl = page.url();
    if (finalUrl.includes('seplog') || finalUrl.includes('accounts.google.com')) {
      return { success: false, message: `Google SSO login may have failed. Current URL: ${finalUrl}` };
    }

    return { success: true };
  }
}

// Re-export for tests / existing consumers that import types from this file
export type { ISkywardFullExtract } from '@scholaracle/scraper-core';
// Retain these refs so existing usages of strategy-store don't break (used in recipe via scraper-core now)
void useStrategy;
void computeFingerprint;

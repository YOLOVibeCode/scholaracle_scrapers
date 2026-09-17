/**
 * Canvas LMS Browser Scraper
 *
 * Uses Playwright to authenticate then delegates all extraction to the shared
 * canvas-recipe from @scholaracle/scraper-core. Vision analysis (images → Claude)
 * has moved to server-side ingest post-processing.
 */

import { type Page, type Browser, type BrowserContext } from 'playwright';
import { mkdirSync } from 'node:fs';
import { BaseScraper } from '../../core/base-scraper';
import type { ISlcDeltaOp } from '@scholaracle/contracts';
import type { IScraperConfig, IScraperMetadata } from '../../core/scraper-types';
import {
  runCanvasRecipe,
  transformCanvasExtract,
  type ICanvasBrowserExtract,
} from '@scholaracle/scraper-core';
import { PlaywrightPageDriver } from '../../core/playwright-driver';
import metadata from './metadata.json';

export class CanvasScraper extends BaseScraper {
  private browser: Browser | null = null;
  private persistentContext: BrowserContext | null = null;
  private driver: PlaywrightPageDriver | null = null;
  private baseUrl = '';

  get metadata(): IScraperMetadata {
    return metadata as IScraperMetadata;
  }

  async initialize(config: IScraperConfig): Promise<void> {
    this.config = config;
    this.baseUrl = config.credentials.baseUrl.replace(/\/$/, '');

    const { chromium } = await import('playwright');
    const isHeadless = config.options?.headless ?? true;
    const profileDir = config.options?.profileDir;

    let page: Page;
    if (profileDir) {
      mkdirSync(profileDir, { recursive: true });
      this.persistentContext = await chromium.launchPersistentContext(profileDir, {
        headless: isHeadless,
      });
      page = this.persistentContext.pages()[0] ?? (await this.persistentContext.newPage());
    } else {
      this.browser = await chromium.launch({ headless: isHeadless });
      const context = await this.browser.newContext();
      page = await context.newPage();
    }
    page.setDefaultTimeout(config.options?.timeout ?? 20000);
    this.driver = new PlaywrightPageDriver(page);
  }

  async authenticate(): Promise<{ success: boolean; message?: string }> {
    if (!this.driver) return { success: false, message: 'Driver not initialized' };
    const page = this.driver.page;

    try {
      await page.goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 20000 });

      const currentUrl = page.url();
      const loginMethod = this.config!.credentials.loginMethod ?? 'direct';

      if (currentUrl.includes('accounts.google.com') || loginMethod === 'google_sso') {
        if (!currentUrl.includes('accounts.google.com')) {
          const googleLink = page.locator(
            'a:has-text("Google"), a[href*="google"], button:has-text("Google"), [class*="google"]',
          ).first();
          if (await googleLink.count() > 0) {
            await googleLink.click();
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          }
        }

        if (page.url().includes('accounts.google.com')) {
          await this.loginViaGoogle(
            page,
            this.config!.credentials.username ?? '',
            this.config!.credentials.password ?? '',
          );
        }
      } else {
        const emailInput = page.locator(
          'input[type="email"], input[name="pseudonym_session[unique_id]"], #pseudonym_session_unique_id',
        );
        if (await emailInput.count() > 0) {
          const passInput = page.locator(
            'input[type="password"], input[name="pseudonym_session[password]"], #pseudonym_session_password',
          );
          await emailInput.fill(this.config!.credentials.username ?? '');
          await passInput.fill(this.config!.credentials.password ?? '');
          await page.locator(
            'input[type="submit"][value="Log In"], button[type="submit"]:has-text("Log In")',
          ).first().click();
          await page.waitForLoadState('networkidle');
        }
      }

      await page.waitForLoadState('networkidle').catch(() => {});

      const finalUrl = page.url();
      if (finalUrl.includes('accounts.google.com') || finalUrl.includes('/login')) {
        await this.captureAuthFailureScreenshot(page);
        return { success: false, message: `Login may have failed. Current URL: ${finalUrl}` };
      }

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.captureAuthFailureScreenshot(page);
      return { success: false, message: msg };
    }
  }

  private async captureAuthFailureScreenshot(page: Page): Promise<void> {
    try {
      mkdirSync('output', { recursive: true });
      const path = `output/canvas-auth-failure-${Date.now()}.png`;
      await page.screenshot({ path, fullPage: false });
      this.emitProgress('authenticating', `Auth failure screenshot saved → ${path}`, {
        url: page.url(),
      });
    } catch {
      // screenshot is best-effort
    }
  }

  async scrape(): Promise<Record<string, unknown>> {
    if (!this.driver) throw new Error('Driver not initialized');
    const extract = await runCanvasRecipe(this.driver, this.baseUrl);
    return extract as unknown as Record<string, unknown>;
  }

  transform(rawData: Record<string, unknown>): ISlcDeltaOp[] {
    const extract = rawData as unknown as ICanvasBrowserExtract;
    return transformCanvasExtract(extract, {
      provider: this.config!.provider,
      adapterId: this.config!.adapterId,
      studentExternalId: this.config!.studentExternalId,
      institutionExternalId: this.config!.institutionExternalId,
    });
  }

  async getRequestHeaders(): Promise<Record<string, string>> {
    if (!this.driver) return {};
    try {
      const context = this.driver.page.context();
      const cookies = await context.cookies();
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      return cookieHeader ? { Cookie: cookieHeader } : {};
    } catch {
      return {};
    }
  }

  async cleanup(): Promise<void> {
    if (this.persistentContext) {
      await this.persistentContext.close().catch(() => {});
      this.persistentContext = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.driver = null;
  }

  private async loginViaGoogle(page: Page, email: string, password: string): Promise<void> {
    const isHeaded = this.config?.options?.headless === false;

    // Best-effort auto-fill: any step may be absent (account chooser, saved
    // session) or replaced by a challenge only a human can answer.
    try {
      const accountTile = page
        .locator(`[data-identifier="${email}" i], [data-email="${email}" i]`)
        .first();
      if (await accountTile.count() > 0) {
        await accountTile.click();
      } else {
        const emailInput = page.locator('input[type="email"], input[name="identifier"]');
        await emailInput.waitFor({ state: 'visible', timeout: 10000 });
        await emailInput.fill(email);
        await page.click('button:has-text("Next"), #identifierNext button');
      }

      const passLocator = page.locator('input[type="password"]:visible, input[name="Passwd"]:visible');
      await passLocator.waitFor({ state: 'visible', timeout: 15000 });
      await passLocator.fill(password);
      await page.click('#passwordNext button, button:has-text("Next")');
    } catch {
      if (!isHeaded) throw new Error('Google SSO auto-fill failed and no visible browser to complete it manually. Re-run headed (or with a persistent profileDir already signed in).');
      this.emitProgress('authenticating', 'Google SSO auto-fill did not complete — finish sign-in in the browser window.');
    }

    // Headed runs get a long window so a human can answer MFA / "verify it's
    // you" challenges; the session then persists via profileDir for future runs.
    const timeout = isHeaded ? 180000 : 30000;
    if (isHeaded) {
      this.emitProgress('authenticating', 'Waiting for Google sign-in to complete (answer any MFA prompt in the browser window)...');
    }
    await page.waitForURL((url) => !url.hostname.includes('accounts.google.com'), { timeout });
  }
}

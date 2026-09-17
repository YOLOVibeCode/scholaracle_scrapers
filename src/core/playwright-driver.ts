/**
 * Playwright implementation of IPageDriver for the CLI.
 *
 * Uses the CLI's locally installed playwright package.
 * Implements IPageDriver from @scholaracle/scraper-core so recipes in
 * scraper-core work without modification.
 */

import type { Page, Browser, BrowserContext } from 'playwright';
import type { IPageDriver, IGotoOptions, IWaitOptions, BrowserFn } from '@scholaracle/scraper-core';

export class PlaywrightPageDriver implements IPageDriver {
  private _page: Page;

  constructor(page: Page) {
    this._page = page;
  }

  /** Replace the internal page reference (e.g. when Skyward opens a popup). */
  setPage(page: Page): void {
    this._page = page;
  }

  get page(): Page {
    return this._page;
  }

  async goto(url: string, options?: IGotoOptions): Promise<void> {
    const waitUntil = options?.waitUntil === 'networkidle' ? 'networkidle' : 'load';
    await this._page.goto(url, {
      waitUntil,
      timeout: options?.timeout ?? 20000,
    });
  }

  url(): string {
    return this._page.url();
  }

  async evaluate<TArgs extends unknown[], TResult>(
    fn: BrowserFn<TArgs, TResult>,
    ...args: TArgs
  ): Promise<TResult> {
    const arg = args.length === 1 ? args[0] : args.length === 0 ? undefined : args;
    // page.evaluate() may use any with immediate cast per repo rules (M7 exception)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this._page.evaluate(fn as any, arg) as Promise<TResult>;
  }

  async content(): Promise<string> {
    return this._page.content();
  }

  async waitForLoad(options?: IWaitOptions): Promise<void> {
    await this._page
      .waitForLoadState('networkidle', {
        timeout: options?.timeout ?? 15000,
      })
      .catch(() => {});
  }

  async waitForUrlIncludes(pattern: string, options?: IWaitOptions): Promise<void> {
    await this._page.waitForURL((url) => url.href.includes(pattern), {
      timeout: options?.timeout ?? 20000,
    });
  }

  async sleep(ms: number): Promise<void> {
    await this._page.waitForTimeout(ms);
  }

  onNewPage(handler: (page: IPageDriver) => Promise<void>): void {
    const context = this._page.context();
    context.on('page', async (newPage: Page) => {
      await newPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      const newDriver = new PlaywrightPageDriver(newPage);
      await handler(newDriver);
      this._page = newPage;
    });
  }
}

/**
 * Factory: launch a browser and return a PlaywrightPageDriver.
 */
export async function createPlaywrightDriver(options?: {
  headless?: boolean;
  timeout?: number;
  userAgent?: string;
  viewport?: { width: number; height: number };
}): Promise<{ driver: PlaywrightPageDriver; browser: Browser; context: BrowserContext }> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: options?.headless ?? true });
  const context = await browser.newContext({
    viewport: options?.viewport ?? { width: 1280, height: 900 },
    userAgent: options?.userAgent,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(options?.timeout ?? 20000);
  const driver = new PlaywrightPageDriver(page);
  return { driver, browser, context };
}

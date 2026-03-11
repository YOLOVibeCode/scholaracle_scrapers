/**
 * Shared Playwright mocks for scraper unit tests (ISP: one concern per mock).
 * Use createMockPage(), createMockContext(), createMockBrowser() in tests.
 */

function createMockLocatorLeaf() {
  const leaf = {
    fill: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(1),
    waitFor: jest.fn().mockResolvedValue(undefined),
    selectOption: jest.fn().mockResolvedValue(undefined),
    nth: jest.fn().mockImplementation(function (this: typeof leaf) {
      return this;
    }),
    first: jest.fn().mockImplementation(function (this: typeof leaf) {
      return this;
    }),
  };
  leaf.nth.mockReturnValue(leaf);
  leaf.first.mockReturnValue(leaf);
  return leaf;
}

export function createMockLocator() {
  return createMockLocatorLeaf();
}

export function createMockPage(overrides: { url?: string; evaluateReturn?: unknown } = {}) {
  const locator = jest.fn().mockReturnValue(createMockLocator());
  const goto = jest.fn().mockResolvedValue(undefined);
  const waitForLoadState = jest.fn().mockResolvedValue(undefined);
  const waitForTimeout = jest.fn().mockResolvedValue(undefined);
  const waitForURL = jest.fn().mockResolvedValue(undefined);
  const waitForSelector = jest.fn().mockResolvedValue(undefined);
  const evaluate = jest.fn().mockResolvedValue(overrides.evaluateReturn ?? null);
  const content = jest.fn().mockResolvedValue('<html></html>');
  const setDefaultTimeout = jest.fn();
  const fill = jest.fn().mockResolvedValue(undefined);
  const click = jest.fn().mockResolvedValue(undefined);

  const urlFn = jest.fn().mockReturnValue(overrides.url ?? 'https://example.instructure.com');
  const page = {
    goto,
    url: urlFn,
    locator,
    waitForLoadState,
    waitForTimeout,
    waitForURL,
    waitForSelector,
    evaluate,
    content,
    setDefaultTimeout,
    fill,
    click,
  };
  return page;
}

export function createMockContext() {
  const newPage = jest.fn().mockResolvedValue(createMockPage());
  const on = jest.fn();

  return {
    newPage,
    on,
  };
}

export function createMockBrowser() {
  const newContext = jest.fn().mockResolvedValue(createMockContext());
  const close = jest.fn().mockResolvedValue(undefined);

  return {
    newContext,
    close,
  };
}

export function createMockChromium() {
  const launch = jest.fn().mockResolvedValue(createMockBrowser());
  return { chromium: { launch } };
}

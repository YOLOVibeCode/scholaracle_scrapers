import type { BaseScraper } from './base-scraper';

type ScraperFactory = () => BaseScraper;

const REGISTRY = new Map<string, ScraperFactory>();

/** Register a platform name to a scraper factory. */
export function registerScraper(platform: string, factory: ScraperFactory): void {
  REGISTRY.set(platform.toLowerCase(), factory);
}

/** Create a scraper instance by platform name. Throws if unknown. */
export function createScraper(platform: string): BaseScraper {
  const factory = REGISTRY.get(platform.toLowerCase());
  if (!factory) {
    const known = [...REGISTRY.keys()].join(', ');
    throw new Error(`Unknown scraper platform "${platform}". Registered: ${known || 'none'}`);
  }
  return factory();
}

/** Return all registered platform names. */
export function getRegisteredPlatforms(): string[] {
  return [...REGISTRY.keys()];
}

/**
 * Classifies a provider as SIS or LMS.
 * SIS scrapers run first because they produce authoritative grades.
 */
export function isProviderSis(provider: string): boolean {
  return ['skyward', 'aeries', 'powerschool', 'infinite-campus'].includes(provider.toLowerCase());
}

// Auto-register known scrapers via lazy imports to avoid circular deps
registerScraper('canvas', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CanvasScraper } = require('../scrapers/canvas/canvas-scraper');
  return new CanvasScraper();
});

registerScraper('skyward', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SkywardScraper } = require('../scrapers/skyward/skyward-scraper');
  return new SkywardScraper();
});

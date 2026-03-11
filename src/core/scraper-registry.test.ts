import { createScraper, getRegisteredPlatforms, isProviderSis } from './scraper-registry';

describe('scraper-registry', () => {
  it('should have canvas and skyward registered', () => {
    const platforms = getRegisteredPlatforms();
    expect(platforms).toContain('canvas');
    expect(platforms).toContain('skyward');
  });

  it('should create a canvas scraper', () => {
    const scraper = createScraper('canvas');
    expect(scraper).toBeDefined();
    expect(scraper.metadata.id).toBe('canvas-browser');
  });

  it('should create a skyward scraper', () => {
    const scraper = createScraper('skyward');
    expect(scraper).toBeDefined();
    expect(scraper.metadata.id).toBe('skyward-browser');
  });

  it('should be case-insensitive', () => {
    const scraper = createScraper('Canvas');
    expect(scraper.metadata.id).toBe('canvas-browser');
  });

  it('should throw for unknown platform', () => {
    expect(() => createScraper('unknown-platform')).toThrow('Unknown scraper platform');
  });
});

describe('isProviderSis', () => {
  it('should classify skyward as SIS', () => {
    expect(isProviderSis('skyward')).toBe(true);
  });

  it('should classify aeries as SIS', () => {
    expect(isProviderSis('aeries')).toBe(true);
  });

  it('should classify canvas as LMS', () => {
    expect(isProviderSis('canvas')).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(isProviderSis('Skyward')).toBe(true);
    expect(isProviderSis('AERIES')).toBe(true);
    expect(isProviderSis('Canvas')).toBe(false);
  });
});

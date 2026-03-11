import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CACHE_DIR = join(homedir(), '.scholaracle-scraper');
const CACHE_FILE = 'course-normalization.json';
const EXPIRY_DAYS = 30;

interface ICacheEntry {
  readonly canonical: string;
  readonly cachedAt: string;
}

interface ICacheFile {
  readonly entries: Record<string, ICacheEntry>;
}

function cacheKey(raw: string, provider: string): string {
  return `${provider}::${raw}`;
}

function isExpired(entry: ICacheEntry): boolean {
  const age = Date.now() - new Date(entry.cachedAt).getTime();
  return age > EXPIRY_DAYS * 24 * 60 * 60 * 1000;
}

function loadCache(): ICacheFile {
  const path = join(CACHE_DIR, CACHE_FILE);
  if (!existsSync(path)) return { entries: {} };
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ICacheFile;
  } catch {
    return { entries: {} };
  }
}

function saveCache(cache: ICacheFile): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, CACHE_FILE), JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Look up cached canonical titles. Returns a partial map (only cache hits).
 */
export function getCachedNormalizations(
  titles: ReadonlyArray<{ readonly raw: string; readonly provider: string }>,
): Record<string, string> {
  const cache = loadCache();
  const result: Record<string, string> = {};
  for (const t of titles) {
    const key = cacheKey(t.raw, t.provider);
    const entry = cache.entries[key];
    if (entry && !isExpired(entry)) {
      result[t.raw] = entry.canonical;
    }
  }
  return result;
}

/**
 * Store AI-generated canonical titles in the cache.
 */
export function setCachedNormalizations(
  mappings: ReadonlyArray<{ readonly raw: string; readonly provider: string; readonly canonical: string }>,
): void {
  const cache = loadCache();
  const entries = { ...cache.entries };
  const now = new Date().toISOString();
  for (const m of mappings) {
    entries[cacheKey(m.raw, m.provider)] = { canonical: m.canonical, cachedAt: now };
  }
  // Prune expired entries while we're at it
  for (const [key, entry] of Object.entries(entries)) {
    if (isExpired(entry)) delete entries[key];
  }
  saveCache({ entries });
}

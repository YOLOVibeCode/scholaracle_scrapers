import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IAssetManifest, IAssetManifestEntry } from './scraper-types';

/** Default directory for per-source manifests. */
const DEFAULT_MANIFESTS_DIR = join(homedir(), '.scholaracle-scraper', 'manifests');

/**
 * Persists and queries per-source asset manifest (originalUrl -> server mapping).
 * Manifest path: baseDir/<sourceId>.json.
 */
export class AssetManifest {
  private readonly baseDir: string;
  private sourceId: string = '';
  private provider: string = '';
  private entries: Record<string, IAssetManifestEntry> = {};

  constructor(baseDir: string = DEFAULT_MANIFESTS_DIR) {
    this.baseDir = baseDir;
  }

  get path(): string {
    if (!this.sourceId) throw new Error('Manifest not loaded. Call load(sourceId, provider) first.');
    return join(this.baseDir, `${this.sourceId}.json`);
  }

  /** Load manifest for source; creates empty in-memory state if file missing. */
  async load(sourceId: string, provider: string): Promise<void> {
    this.sourceId = sourceId;
    this.provider = provider;
    const filePath = join(this.baseDir, `${sourceId}.json`);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const data = JSON.parse(raw) as IAssetManifest;
      if (data.sourceId !== sourceId || data.provider !== provider) {
        this.entries = {};
      } else {
        this.entries = { ...(data.entries ?? {}) };
      }
    } catch {
      this.entries = {};
    }
  }

  /** Load manifest from disk by sourceId only (reads provider from file). Returns true if file existed. */
  async loadFromFile(sourceId: string): Promise<boolean> {
    const filePath = join(this.baseDir, `${sourceId}.json`);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const data = JSON.parse(raw) as IAssetManifest;
      this.sourceId = data.sourceId;
      this.provider = data.provider;
      this.entries = { ...(data.entries ?? {}) };
      return true;
    } catch {
      return false;
    }
  }

  /** Write current entries to disk. */
  async save(): Promise<void> {
    if (!this.sourceId) throw new Error('Manifest not loaded. Call load(sourceId, provider) first.');
    await mkdir(this.baseDir, { recursive: true });
    const manifest: IAssetManifest = {
      sourceId: this.sourceId,
      provider: this.provider,
      lastUpdated: new Date().toISOString(),
      entries: this.entries,
    };
    await writeFile(this.path, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  has(url: string): boolean {
    return url in this.entries;
  }

  get(url: string): IAssetManifestEntry | undefined {
    return this.entries[url];
  }

  set(url: string, entry: IAssetManifestEntry): void {
    this.entries[url] = entry;
  }

  remove(url: string): void {
    delete this.entries[url];
  }

  /** Remove all entries for the given academic term. */
  pruneByTerm(termId: string): void {
    for (const [url, entry] of Object.entries(this.entries)) {
      if (entry.academicTermId === termId) delete this.entries[url];
    }
  }

  /** Remove entries whose URL is not in the given list (stale from portal). */
  pruneStale(urls: string[]): void {
    const set = new Set(urls);
    for (const url of Object.keys(this.entries)) {
      if (!set.has(url)) delete this.entries[url];
    }
  }

  /** Return current entries (readonly snapshot). */
  getEntries(): Record<string, IAssetManifestEntry> {
    return { ...this.entries };
  }
}

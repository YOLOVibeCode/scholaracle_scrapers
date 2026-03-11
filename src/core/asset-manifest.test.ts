import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AssetManifest } from './asset-manifest';

describe('AssetManifest', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'asset-manifest-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe('load and save', () => {
    it('should start with empty entries when file does not exist', async () => {
      const manifest = new AssetManifest(baseDir);
      await manifest.load('source-1', 'canvas');
      expect(manifest.has('https://example.com/file.pdf')).toBe(false);
      expect(manifest.get('https://example.com/file.pdf')).toBeUndefined();
    });

    it('should persist and reload entries', async () => {
      const manifest = new AssetManifest(baseDir);
      await manifest.load('source-1', 'canvas');
      manifest.set('https://example.com/a.pdf', {
        originalUrl: 'https://example.com/a.pdf',
        contentHash: 'abc',
        serverAssetId: 'id-1',
        serverUrl: 'https://api.example/assets/id-1',
        fileName: 'a.pdf',
        fileSize: 100,
        uploadedAt: '2026-01-01T00:00:00Z',
      });
      await manifest.save();

      const manifest2 = new AssetManifest(baseDir);
      await manifest2.load('source-1', 'canvas');
      expect(manifest2.has('https://example.com/a.pdf')).toBe(true);
      expect(manifest2.get('https://example.com/a.pdf')?.serverAssetId).toBe('id-1');
    });

    it('should throw when save() before load()', async () => {
      const manifest = new AssetManifest(baseDir);
      await expect(manifest.save()).rejects.toThrow('Manifest not loaded');
    });

    it('should throw when path getter used before load()', () => {
      const manifest = new AssetManifest(baseDir);
      expect(() => manifest.path).toThrow('Manifest not loaded');
    });
  });

  describe('has, get, set, remove', () => {
    it('should return false for missing url', async () => {
      const manifest = new AssetManifest(baseDir);
      await manifest.load('s1', 'canvas');
      expect(manifest.has('https://x.com/f')).toBe(false);
    });

    it('should return true and entry after set', async () => {
      const manifest = new AssetManifest(baseDir);
      await manifest.load('s1', 'canvas');
      const entry = {
        originalUrl: 'https://x.com/f',
        contentHash: 'h',
        serverAssetId: 'id',
        serverUrl: 'https://api/assets/id',
        fileName: 'f',
        fileSize: 1,
        uploadedAt: '2026-01-01T00:00:00Z',
      };
      manifest.set('https://x.com/f', entry);
      expect(manifest.has('https://x.com/f')).toBe(true);
      expect(manifest.get('https://x.com/f')).toEqual(entry);
    });

    it('should remove entry', async () => {
      const manifest = new AssetManifest(baseDir);
      await manifest.load('s1', 'canvas');
      manifest.set('https://x.com/f', {
        originalUrl: 'https://x.com/f',
        contentHash: 'h',
        serverAssetId: 'id',
        serverUrl: 'https://api/assets/id',
        fileName: 'f',
        fileSize: 1,
        uploadedAt: '2026-01-01T00:00:00Z',
      });
      manifest.remove('https://x.com/f');
      expect(manifest.has('https://x.com/f')).toBe(false);
      expect(manifest.get('https://x.com/f')).toBeUndefined();
    });
  });

  describe('pruneByTerm', () => {
    it('should remove only entries for the given term', async () => {
      const manifest = new AssetManifest(baseDir);
      await manifest.load('s1', 'canvas');
      manifest.set('https://a.com/1', {
        originalUrl: 'https://a.com/1',
        contentHash: 'h1',
        serverAssetId: 'id1',
        serverUrl: 'https://api/assets/id1',
        fileName: '1',
        fileSize: 1,
        uploadedAt: '2026-01-01T00:00:00Z',
        academicTermId: 'term-fall',
      });
      manifest.set('https://a.com/2', {
        originalUrl: 'https://a.com/2',
        contentHash: 'h2',
        serverAssetId: 'id2',
        serverUrl: 'https://api/assets/id2',
        fileName: '2',
        fileSize: 1,
        uploadedAt: '2026-01-01T00:00:00Z',
        academicTermId: 'term-spring',
      });
      manifest.pruneByTerm('term-fall');
      expect(manifest.has('https://a.com/1')).toBe(false);
      expect(manifest.has('https://a.com/2')).toBe(true);
    });
  });

  describe('pruneStale', () => {
    it('should remove entries whose url is not in the list', async () => {
      const manifest = new AssetManifest(baseDir);
      await manifest.load('s1', 'canvas');
      manifest.set('https://a.com/1', {
        originalUrl: 'https://a.com/1',
        contentHash: 'h1',
        serverAssetId: 'id1',
        serverUrl: 'https://api/assets/id1',
        fileName: '1',
        fileSize: 1,
        uploadedAt: '2026-01-01T00:00:00Z',
      });
      manifest.set('https://a.com/2', {
        originalUrl: 'https://a.com/2',
        contentHash: 'h2',
        serverAssetId: 'id2',
        serverUrl: 'https://api/assets/id2',
        fileName: '2',
        fileSize: 1,
        uploadedAt: '2026-01-01T00:00:00Z',
      });
      manifest.pruneStale(['https://a.com/1']);
      expect(manifest.has('https://a.com/1')).toBe(true);
      expect(manifest.has('https://a.com/2')).toBe(false);
    });
  });

  describe('loadFromFile', () => {
    it('should return false when file does not exist', async () => {
      const manifest = new AssetManifest(baseDir);
      const loaded = await manifest.loadFromFile('nonexistent');
      expect(loaded).toBe(false);
    });

    it('should load sourceId and provider from existing file', async () => {
      const manifest = new AssetManifest(baseDir);
      await manifest.load('source-1', 'canvas');
      manifest.set('https://a.com/1', {
        originalUrl: 'https://a.com/1',
        contentHash: 'h',
        serverAssetId: 'id',
        serverUrl: 'https://api/assets/id',
        fileName: '1',
        fileSize: 1,
        uploadedAt: '2026-01-01T00:00:00Z',
      });
      await manifest.save();
      const manifest2 = new AssetManifest(baseDir);
      const loaded = await manifest2.loadFromFile('source-1');
      expect(loaded).toBe(true);
      expect(manifest2.has('https://a.com/1')).toBe(true);
    });
  });

  describe('getEntries', () => {
    it('should return a copy of entries', async () => {
      const manifest = new AssetManifest(baseDir);
      await manifest.load('s1', 'canvas');
      manifest.set('https://a.com/1', {
        originalUrl: 'https://a.com/1',
        contentHash: 'h1',
        serverAssetId: 'id1',
        serverUrl: 'https://api/assets/id1',
        fileName: '1',
        fileSize: 1,
        uploadedAt: '2026-01-01T00:00:00Z',
      });
      const entries = manifest.getEntries();
      expect(Object.keys(entries)).toHaveLength(1);
      expect(entries).not.toBe(manifest.getEntries());
    });
  });
});

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadAssets } from './asset-downloader';
import type { IAssetDescriptor } from './scraper-types';

function makeDescriptor(overrides: Partial<IAssetDescriptor> = {}): IAssetDescriptor {
  return {
    originalUrl: 'https://example.com/file.pdf',
    fileName: 'file.pdf',
    entityType: 'courseMaterial',
    entityExternalId: 'ext-1',
    ...overrides,
  };
}

describe('downloadAssets', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should skip download when manifest entry has same etag and lastModified', async () => {
    globalThis.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return Promise.resolve(
          new Response(null, {
            status: 200,
            headers: { etag: '"abc"', 'last-modified': 'Mon, 01 Jan 2026 00:00:00 GMT' },
          }),
        );
      }
      return Promise.resolve(new Response('body'));
    }) as typeof fetch;

    const getManifestEntry = jest.fn().mockReturnValue({
      originalUrl: 'https://example.com/file.pdf',
      contentHash: 'h',
      etag: '"abc"',
      lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT',
      serverAssetId: 'id-1',
      serverUrl: 'https://api.example/assets/id-1',
      fileName: 'file.pdf',
      fileSize: 4,
      uploadedAt: '2026-01-01T00:00:00Z',
    });

    const results = await downloadAssets([makeDescriptor()], {
      getManifestEntry: (url) => getManifestEntry(url) as ReturnType<typeof getManifestEntry>,
      maxConcurrentDownloads: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.skipped).toBe(true);
    expect(results[0]?.cachedServerUrl).toBe('https://api.example/assets/id-1');
    expect(results[0]?.localPath).toBe('');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com/file.pdf',
      expect.objectContaining({ method: 'HEAD' }),
    );
    expect((globalThis.fetch as jest.Mock).mock.calls.filter((c: unknown[]) => (c[1] as RequestInit)?.method === 'GET')).toHaveLength(0);
  });

  it('should download when manifest entry has different etag', async () => {
    const body = 'file content here';
    globalThis.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return Promise.resolve(
          new Response(null, {
            status: 200,
            headers: {
              etag: '"new-etag"',
              'last-modified': 'Tue, 02 Jan 2026 00:00:00 GMT',
              'content-length': String(body.length),
            },
          }),
        );
      }
      return Promise.resolve(
        new Response(body, {
          headers: { 'content-length': String(body.length) },
        }),
      );
    }) as typeof fetch;

    const getManifestEntry = jest.fn().mockReturnValue({
      etag: '"old-etag"',
      lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT',
      serverUrl: 'https://api.example/old',
      contentHash: 'old',
      fileSize: 0,
      originalUrl: '',
      serverAssetId: '',
      fileName: '',
      uploadedAt: '',
    });

    const results = await downloadAssets([makeDescriptor()], {
      getManifestEntry: (url) => getManifestEntry(url) as ReturnType<typeof getManifestEntry>,
      maxConcurrentDownloads: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.skipped).toBe(false);
    expect(results[0]?.localPath).toBeTruthy();
    expect(results[0]?.contentHash).toBeTruthy();
    expect(results[0]?.fileSize).toBe(body.length);
  });

  it('should skip when Content-Length exceeds assetSizeLimit', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-length': '200000000' },
      }),
    ) as typeof fetch;

    const results = await downloadAssets(
      [makeDescriptor()],
      { assetSizeLimit: 100, maxConcurrentDownloads: 1 },
    );

    expect(results[0]?.skipped).toBe(true);
    expect(results[0]?.localPath).toBe('');
    expect((globalThis.fetch as jest.Mock).mock.calls.every((c: unknown[]) => (c[1] as RequestInit)?.method === 'HEAD')).toBe(true);
  });

  it('should respect maxConcurrentDownloads', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    globalThis.fetch = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      if (init?.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-length': '10' },
        });
      }
      return new Response('1234567890');
    }) as typeof fetch;

    const descriptors = [
      makeDescriptor({ originalUrl: 'https://a.com/1', entityExternalId: '1' }),
      makeDescriptor({ originalUrl: 'https://a.com/2', entityExternalId: '2' }),
      makeDescriptor({ originalUrl: 'https://a.com/3', entityExternalId: '3' }),
    ];
    await downloadAssets(descriptors, { maxConcurrentDownloads: 2 });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('should return empty results for empty descriptors', async () => {
    const results = await downloadAssets([], { maxConcurrentDownloads: 1 });
    expect(results).toEqual([]);
  });
});

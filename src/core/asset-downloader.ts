import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  IAssetDescriptor,
  IAssetManifestEntry,
  IDownloadResult,
} from './scraper-types';

const DEFAULT_MAX_CONCURRENT = 5;
const DEFAULT_SIZE_LIMIT_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_RETRIES = 3;

export interface IAssetDownloaderOptions {
  readonly maxConcurrentDownloads?: number;
  readonly assetSizeLimit?: number;
  readonly runId?: string;
  readonly requestHeaders?: Record<string, string>;
  /** Return manifest entry for url to skip download if unchanged. */
  readonly getManifestEntry?: (url: string) => IAssetManifestEntry | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run tasks with at most `concurrency` in flight. */
async function runWithLimit<T>(
  concurrency: number,
  items: readonly T[],
  fn: (item: T) => Promise<IDownloadResult>,
): Promise<IDownloadResult[]> {
  const results: IDownloadResult[] = [];
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      const r = await fn(items[i]!);
      results[i] = r;
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Streams response body to file and returns SHA-256 hex hash. */
async function streamToFileWithHash(
  response: Response,
  destPath: string,
): Promise<{ hash: string; bytesWritten: number }> {
  const body = response.body;
  if (!body) throw new Error('Empty response body');
  const hash = createHash('sha256');
  let bytesWritten = 0;
  const reader = body.getReader();
  const writer = createWriteStream(destPath);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        hash.update(value);
        bytesWritten += value.length;
        writer.write(value);
      }
    }
    writer.end();
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } finally {
    reader.releaseLock();
  }
  return { hash: hash.digest('hex'), bytesWritten };
}

/**
 * Downloads assets with concurrency limit, HEAD-based skip, SHA-256 hashing, retry, and size guard.
 */
export async function downloadAssets(
  descriptors: readonly IAssetDescriptor[],
  options: IAssetDownloaderOptions,
): Promise<IDownloadResult[]> {
  const maxConcurrent = options.maxConcurrentDownloads ?? DEFAULT_MAX_CONCURRENT;
  const sizeLimit = options.assetSizeLimit ?? DEFAULT_SIZE_LIMIT_BYTES;
  const runId = options.runId ?? randomUUID();
  const baseDir = join(tmpdir(), `scholaracle-assets-${runId}`);
  await mkdir(baseDir, { recursive: true });
  const getEntry = options.getManifestEntry ?? (() => undefined);
  const headers = options.requestHeaders ?? {};

  const downloadOne = async (d: IAssetDescriptor): Promise<IDownloadResult> => {
      const doFetch = async (method: 'HEAD' | 'GET'): Promise<Response> => {
        let lastErr: Error | undefined;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const res = await fetch(d.originalUrl, {
              method,
              headers: { ...headers },
              redirect: 'follow',
            });
            if (res.status >= 500 && attempt < MAX_RETRIES - 1) {
              await sleep(500 * Math.pow(2, attempt));
              continue;
            }
            return res;
          } catch (e) {
            lastErr = e instanceof Error ? e : new Error(String(e));
            if (attempt < MAX_RETRIES - 1) await sleep(500 * Math.pow(2, attempt));
          }
        }
        throw lastErr ?? new Error('Download failed');
      };

      const headRes = await doFetch('HEAD');
      if (headRes.status === 404 || headRes.status === 403 || headRes.status === 410) {
        return {
          descriptor: d,
          localPath: '',
          contentHash: '',
          fileSize: 0,
          skipped: true,
        };
      }
      const etag = headRes.headers.get('etag') ?? undefined;
      const lastModified = headRes.headers.get('last-modified') ?? undefined;
      const contentLength = headRes.headers.get('content-length');
      const size = contentLength ? parseInt(contentLength, 10) : undefined;
      if (size !== undefined && size > sizeLimit) {
        return {
          descriptor: d,
          localPath: '',
          contentHash: '',
          fileSize: 0,
          skipped: true,
        };
      }

      const entry = getEntry(d.originalUrl);
      if (entry && entry.etag === etag && entry.lastModified === lastModified) {
        return {
          descriptor: d,
          localPath: '',
          contentHash: entry.contentHash,
          fileSize: entry.fileSize,
          skipped: true,
          cachedServerUrl: entry.serverUrl,
          etag,
          lastModified,
        };
      }

      const getRes = await doFetch('GET');
      if (!getRes.ok) {
        return {
          descriptor: d,
          localPath: '',
          contentHash: '',
          fileSize: 0,
          skipped: true,
        };
      }
      const safeName = Buffer.from(d.fileName, 'utf-8')
        .toString('base64url')
        .slice(0, 64);
      const localPath = join(baseDir, `${safeName}-${randomUUID().slice(0, 8)}`);
      const { hash, bytesWritten } = await streamToFileWithHash(getRes, localPath);
      if (bytesWritten > sizeLimit) {
        await rm(localPath, { force: true });
        return {
          descriptor: d,
          localPath: '',
          contentHash: '',
          fileSize: 0,
          skipped: true,
        };
      }
      return {
        descriptor: d,
        localPath,
        contentHash: hash,
        fileSize: bytesWritten,
        skipped: false,
        etag,
        lastModified,
      };
  };

  return runWithLimit(maxConcurrent, descriptors, downloadOne);
}

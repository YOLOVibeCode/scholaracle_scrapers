import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  IAssetDescriptor,
  IAssetManifestEntry,
  ISlcAssignment,
  ISlcAttachment,
  ISlcCourseMaterial,
  ISlcDeltaOp,
  ISlcMessage,
  IScraperConfig,
} from './types';
import { AssetManifest } from './asset-manifest';
import { downloadAssets } from './asset-downloader';
import { AssetUploader } from './asset-uploader';

export interface IProcessAssetsContext {
  readonly apiBaseUrl: string;
  readonly connectorToken: string;
  readonly requestHeaders?: Record<string, string>;
  readonly runId?: string;
}

/**
 * Scans ops for asset URLs (courseMaterial.url, assignment/message attachments), downloads,
 * uploads, updates manifest, prunes stale entries, rewrites URLs in ops, cleans up temp files.
 */
export async function processAssets(
  ops: readonly ISlcDeltaOp[],
  config: IScraperConfig,
  context: IProcessAssetsContext,
): Promise<ISlcDeltaOp[]> {
  if (config.options?.skipDownloads) return [...ops];
  if (!context.apiBaseUrl || !context.connectorToken) return [...ops];

  const runId = context.runId ?? randomUUID();
  const descriptors = discoverAssetDescriptors(ops);
  if (descriptors.length === 0) return [...ops];

  console.log(`  [Assets] Discovered ${descriptors.length} asset(s) to process`);

  const manifest = new AssetManifest();
  await manifest.load(config.sourceId, config.provider);

  const getManifestEntry = (url: string): IAssetManifestEntry | undefined => manifest.get(url);

  const downloadResults = await downloadAssets(descriptors, {
    maxConcurrentDownloads: config.options?.maxConcurrentDownloads ?? 5,
    assetSizeLimit: config.options?.assetSizeLimit ?? 100 * 1024 * 1024,
    runId,
    requestHeaders: context.requestHeaders,
    getManifestEntry,
  });

  const downloaded = downloadResults.filter(r => !r.skipped && r.localPath);
  const cached = downloadResults.filter(r => r.skipped && r.cachedServerUrl);
  const skipped = downloadResults.filter(r => r.skipped && !r.cachedServerUrl);
  console.log(`  [Assets] Download: ${downloaded.length} new, ${cached.length} cached, ${skipped.length} skipped`);

  const uploader = new AssetUploader(context.apiBaseUrl, context.connectorToken, {
    sourceId: config.sourceId,
    provider: config.provider,
  });
  const uploaded = await uploader.uploadBatch(downloadResults);
  console.log(`  [Assets] Uploaded ${uploaded.length} asset(s) to server`);

  const now = new Date().toISOString();
  for (const u of uploaded) {
    const res = downloadResults.find((r) => r.descriptor.originalUrl === u.originalUrl);
    const desc = res?.descriptor ?? descriptors.find((d) => d.originalUrl === u.originalUrl);
    if (desc) {
      manifest.set(u.originalUrl, {
        originalUrl: u.originalUrl,
        contentHash: u.contentHash,
        etag: res?.etag,
        lastModified: res?.lastModified,
        serverAssetId: u.serverAssetId,
        serverUrl: u.serverUrl,
        fileName: desc.fileName,
        fileSize: res?.fileSize ?? desc.fileSize ?? 0,
        uploadedAt: now,
      });
    }
  }

  const currentUrls = new Set(descriptors.map((d) => d.originalUrl));
  manifest.pruneStale([...currentUrls]);
  await manifest.save();

  const urlToServerUrl = new Map<string, string>();
  for (const u of uploaded) urlToServerUrl.set(u.originalUrl, u.serverUrl);
  for (const r of downloadResults)
    if (r.cachedServerUrl) urlToServerUrl.set(r.descriptor.originalUrl, r.cachedServerUrl);

  const rewritten = rewriteOpsWithServerUrls(ops, urlToServerUrl);

  const firstLocal = downloadResults.find((r) => r.localPath);
  if (firstLocal?.localPath) {
    try {
      await rm(dirname(firstLocal.localPath), { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  return rewritten;
}

function discoverAssetDescriptors(ops: readonly ISlcDeltaOp[]): IAssetDescriptor[] {
  const out: IAssetDescriptor[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    if (op.op !== 'upsert' || !op.record) continue;
    if (op.entity === 'courseMaterial') {
      const rec = op.record as unknown as ISlcCourseMaterial;
      const url = rec.url?.trim();
      if (url && !seen.has(url)) {
        seen.add(url);
        out.push({
          originalUrl: url,
          fileName: rec.fileName ?? rec.title ?? 'file',
          mimeType: rec.mimeType,
          fileSize: rec.fileSize,
          entityType: 'courseMaterial',
          entityExternalId: op.key.externalId,
          courseExternalId: rec.courseExternalId,
        });
      }
    }
    if (op.entity === 'assignment') {
      const rec = op.record as unknown as ISlcAssignment;
      const courseId = rec.courseExternalId;
      const extId = op.key.externalId;
      for (const att of rec.attachments ?? []) {
        const url = att.url?.trim();
        if (url && !seen.has(url)) {
          seen.add(url);
          out.push({
            originalUrl: url,
            fileName: att.name ?? 'attachment',
            mimeType: att.type,
            fileSize: att.size,
            entityType: 'assignment',
            entityExternalId: extId,
            courseExternalId: courseId,
          });
        }
      }
    }
    if (op.entity === 'message') {
      const rec = op.record as unknown as ISlcMessage;
      const courseId = rec.courseExternalId;
      const extId = op.key.externalId;
      for (const att of rec.attachments ?? []) {
        const url = att.url?.trim();
        if (url && !seen.has(url)) {
          seen.add(url);
          out.push({
            originalUrl: url,
            fileName: att.name ?? 'attachment',
            mimeType: att.type,
            fileSize: att.size,
            entityType: 'message',
            entityExternalId: extId,
            courseExternalId: courseId,
          });
        }
      }
    }
  }
  return out;
}

function rewriteOpsWithServerUrls(
  ops: readonly ISlcDeltaOp[],
  urlToServerUrl: Map<string, string>,
): ISlcDeltaOp[] {
  return ops.map((op) => {
    if (op.op !== 'upsert' || !op.record) return op;
    if (op.entity === 'courseMaterial') {
      const rec = op.record as unknown as ISlcCourseMaterial;
      const serverUrl = rec.url ? urlToServerUrl.get(rec.url) : undefined;
      if (!serverUrl) return op;
      return {
        ...op,
        record: { ...rec, url: serverUrl },
      };
    }
    if (op.entity === 'assignment') {
      const rec = op.record as unknown as ISlcAssignment;
      const attachments = rec.attachments?.map((a) => {
        const serverUrl = a.url ? urlToServerUrl.get(a.url) : undefined;
        if (!serverUrl) return a;
        return { ...a, url: serverUrl };
      });
      if (!attachments?.some((a, i) => a.url !== rec.attachments?.[i]?.url)) return op;
      return { ...op, record: { ...rec, attachments } };
    }
    if (op.entity === 'message') {
      const rec = op.record as unknown as ISlcMessage;
      const attachments = rec.attachments?.map((a) => {
        const serverUrl = a.url ? urlToServerUrl.get(a.url) : undefined;
        if (!serverUrl) return a;
        return { ...a, url: serverUrl };
      });
      if (!attachments?.some((a, i) => a.url !== rec.attachments?.[i]?.url)) return op;
      return { ...op, record: { ...rec, attachments } };
    }
    return op;
  });
}

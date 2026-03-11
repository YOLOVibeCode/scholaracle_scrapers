import axios, { type AxiosInstance } from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'node:fs';
import type { IAssetDescriptor, IDownloadResult, IUploadedAsset } from './types';

export interface IAssetUploaderOptions {
  readonly sourceId: string;
  readonly provider: string;
}

export interface IUploadAssetMetadata {
  readonly descriptor: IAssetDescriptor;
  readonly contentHash: string;
  readonly fileSize: number;
}

/**
 * Uploads downloaded asset files to Scholaracle via POST /api/ingest/v1/assets/upload.
 * Uses same connector token auth as ScholaracleUploader.
 */
export class AssetUploader {
  private readonly client: AxiosInstance;
  private readonly sourceId: string;
  private readonly provider: string;

  constructor(baseUrl: string, connectorToken: string, options: IAssetUploaderOptions) {
    this.sourceId = options.sourceId;
    this.provider = options.provider;
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${connectorToken}`,
      },
      timeout: 60_000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  }

  /**
   * Upload a single file. Returns server asset id and URL; server may dedupe by sourceId+contentHash.
   */
  async uploadAsset(
    localPath: string,
    metadata: IUploadAssetMetadata,
  ): Promise<IUploadedAsset> {
    const form = new FormData();
    form.append('file', createReadStream(localPath), {
      filename: metadata.descriptor.fileName,
      contentType: metadata.descriptor.mimeType ?? 'application/octet-stream',
    });
    form.append('sourceId', this.sourceId);
    form.append('provider', this.provider);
    form.append('originalUrl', metadata.descriptor.originalUrl);
    form.append('contentHash', metadata.contentHash);
    form.append('fileName', metadata.descriptor.fileName);
    form.append('entityType', metadata.descriptor.entityType);
    form.append('entityExternalId', metadata.descriptor.entityExternalId);
    if (metadata.descriptor.courseExternalId) {
      form.append('courseExternalId', metadata.descriptor.courseExternalId);
    }
    if (metadata.descriptor.academicTermId) {
      form.append('academicTermId', metadata.descriptor.academicTermId);
    }
    const res = await this.client.post<{ assetId: string; serverUrl: string }>(
      '/api/ingest/v1/assets/upload',
      form,
      { headers: form.getHeaders() },
    );
    const { assetId, serverUrl } = res.data;
    return {
      serverAssetId: assetId,
      serverUrl,
      originalUrl: metadata.descriptor.originalUrl,
      contentHash: metadata.contentHash,
    };
  }

  /**
   * Upload all non-skipped download results that have a localPath.
   * Individual upload failures are logged and skipped so the batch continues.
   */
  async uploadBatch(results: readonly IDownloadResult[]): Promise<IUploadedAsset[]> {
    const toUpload = results.filter((r) => !r.skipped && r.localPath);
    const uploaded: IUploadedAsset[] = [];
    let failCount = 0;
    for (const r of toUpload) {
      const meta: IUploadAssetMetadata = {
        descriptor: r.descriptor,
        contentHash: r.contentHash,
        fileSize: r.fileSize,
      };
      try {
        const u = await this.uploadAsset(r.localPath, meta);
        uploaded.push(u);
      } catch (err: unknown) {
        failCount++;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  [AssetUploader] Failed to upload "${r.descriptor.fileName}": ${msg}`);
      }
    }
    if (failCount > 0) {
      console.warn(`  [AssetUploader] ${failCount}/${toUpload.length} asset(s) failed to upload — continuing with ${uploaded.length} successful`);
    }
    return uploaded;
  }
}

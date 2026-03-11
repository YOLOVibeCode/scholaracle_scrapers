import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import axios from 'axios';
import { AssetUploader } from './asset-uploader';
import type { IAssetDescriptor, IDownloadResult } from './types';

jest.mock('axios');

const mockPost = axios.create as jest.Mock;

function makeDescriptor(overrides: Partial<IAssetDescriptor> = {}): IAssetDescriptor {
  return {
    originalUrl: 'https://example.com/file.pdf',
    fileName: 'file.pdf',
    mimeType: 'application/pdf',
    entityType: 'courseMaterial',
    entityExternalId: 'ext-1',
    courseExternalId: 'course-1',
    ...overrides,
  };
}

describe('AssetUploader', () => {
  let uploader: AssetUploader;
  let postFn: jest.Mock;

  beforeEach(() => {
    postFn = jest.fn();
    mockPost.mockReturnValue({ post: postFn });
    uploader = new AssetUploader('https://api.example', 'token', {
      sourceId: 'source-1',
      provider: 'canvas',
    });
  });

  describe('uploadAsset', () => {
    it('should send multipart request and return server asset id and url', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'asset-upload-'));
      const filePath = join(dir, 'f.pdf');
      writeFileSync(filePath, 'content');
      postFn.mockResolvedValueOnce({
        data: { assetId: 'asset-123', serverUrl: 'https://api.example/assets/asset-123' },
      });

      const result = await uploader.uploadAsset(filePath, {
        descriptor: makeDescriptor(),
        contentHash: 'abc',
        fileSize: 7,
      });

      expect(result).toEqual({
        serverAssetId: 'asset-123',
        serverUrl: 'https://api.example/assets/asset-123',
        originalUrl: 'https://example.com/file.pdf',
        contentHash: 'abc',
      });
      expect(postFn).toHaveBeenCalledWith(
        '/api/ingest/v1/assets/upload',
        expect.any(Object),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('uploadBatch', () => {
    it('should upload only non-skipped results with localPath', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'asset-batch-'));
      const path1 = join(dir, 'a.pdf');
      writeFileSync(path1, 'a');
      postFn
        .mockResolvedValueOnce({
          data: { assetId: 'id-1', serverUrl: 'https://api.example/assets/id-1' },
        })
        .mockResolvedValueOnce({
          data: { assetId: 'id-2', serverUrl: 'https://api.example/assets/id-2' },
        });

      const path2 = join(dir, 'b.pdf');
      writeFileSync(path2, 'bb');
      const results: IDownloadResult[] = [
        {
          descriptor: makeDescriptor({ fileName: 'a.pdf' }),
          localPath: path1,
          contentHash: 'h1',
          fileSize: 1,
          skipped: false,
        },
        {
          descriptor: makeDescriptor({ fileName: 'skip.pdf' }),
          localPath: '',
          contentHash: '',
          fileSize: 0,
          skipped: true,
        },
        {
          descriptor: makeDescriptor({ fileName: 'b.pdf' }),
          localPath: path2,
          contentHash: 'h2',
          fileSize: 2,
          skipped: false,
        },
      ];
      const uploaded = await uploader.uploadBatch(results);
      expect(uploaded).toHaveLength(2);
      expect(uploaded[0]?.serverAssetId).toBe('id-1');
      expect(uploaded[1]?.serverAssetId).toBe('id-2');
      expect(postFn).toHaveBeenCalledTimes(2);
      rmSync(dir, { recursive: true, force: true });
    });

    it('should return empty array when all skipped', async () => {
      const results: IDownloadResult[] = [
        {
          descriptor: makeDescriptor(),
          localPath: '',
          contentHash: '',
          fileSize: 0,
          skipped: true,
          cachedServerUrl: 'https://api.example/cached',
        },
      ];
      const uploaded = await uploader.uploadBatch(results);
      expect(uploaded).toEqual([]);
      expect(postFn).not.toHaveBeenCalled();
    });
  });
});

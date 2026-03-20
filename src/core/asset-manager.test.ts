import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { processAssets } from './asset-manager';
import type { ISlcDeltaOp } from '@scholaracle/contracts';
import type { IScraperConfig } from './scraper-types';

jest.mock('./asset-downloader', () => ({
  downloadAssets: jest.fn(),
}));

jest.mock('./asset-uploader', () => ({
  AssetUploader: jest.fn().mockImplementation(() => ({
    uploadBatch: jest.fn(),
  })),
}));

const { downloadAssets } = jest.requireMock('./asset-downloader') as {
  downloadAssets: jest.Mock;
};
const { AssetUploader } = jest.requireMock('./asset-uploader') as {
  AssetUploader: jest.Mock;
};

const baseConfig: IScraperConfig = {
  credentials: { baseUrl: 'https://canvas.example.com' },
  studentName: 'Student',
  studentExternalId: 'stu-1',
  institutionExternalId: 'inst-1',
  sourceId: 'source-1',
  provider: 'canvas',
  adapterId: 'com.instructure.canvas',
};

const baseContext = {
  apiBaseUrl: 'https://api.example.com',
  connectorToken: 'token',
};

function makeOp(
  entity: 'courseMaterial' | 'assignment' | 'message',
  record: Record<string, unknown>,
  externalId: string,
): ISlcDeltaOp {
  return {
    op: 'upsert',
    entity,
    key: {
      provider: 'canvas',
      adapterId: 'com.instructure.canvas',
      externalId,
      courseExternalId: entity !== 'message' ? 'course-1' : undefined,
    },
    observedAt: new Date().toISOString(),
    record,
  };
}

describe('processAssets', () => {
  let manifestDir: string;

  beforeEach(() => {
    manifestDir = mkdtempSync(join(tmpdir(), 'asset-manager-'));
    downloadAssets.mockReset();
    AssetUploader.mockClear();
  });

  afterEach(() => {
    rmSync(manifestDir, { recursive: true, force: true });
  });

  it('should return ops unchanged when options.skipDownloads is true', async () => {
    const ops: ISlcDeltaOp[] = [
      makeOp('courseMaterial', { title: 'F', courseExternalId: 'c1', type: 'document', url: 'https://x.com/f' }, 'ext-1'),
    ];
    const result = await processAssets(ops, { ...baseConfig, options: { skipDownloads: true } }, baseContext);
    expect(result).toEqual(ops);
    expect(downloadAssets).not.toHaveBeenCalled();
  });

  it('should return ops unchanged when apiBaseUrl is missing', async () => {
    const ops: ISlcDeltaOp[] = [
      makeOp('courseMaterial', { title: 'F', courseExternalId: 'c1', type: 'document', url: 'https://x.com/f' }, 'ext-1'),
    ];
    const result = await processAssets(ops, baseConfig, { ...baseContext, apiBaseUrl: '' });
    expect(result).toEqual(ops);
    expect(downloadAssets).not.toHaveBeenCalled();
  });

  it('should return ops unchanged when no asset URLs in ops', async () => {
    const ops: ISlcDeltaOp[] = [
      {
        op: 'upsert',
        entity: 'course',
        key: { provider: 'canvas', adapterId: 'com.instructure.canvas', externalId: 'course-1' },
        observedAt: new Date().toISOString(),
        record: { title: 'Math' },
      },
    ];
    const result = await processAssets(ops, baseConfig, baseContext);
    expect(result).toEqual(ops);
    expect(downloadAssets).not.toHaveBeenCalled();
  });

  it('should discover assets, call download/upload, and rewrite URLs', async () => {
    const ops: ISlcDeltaOp[] = [
      makeOp('courseMaterial', {
        title: 'Doc',
        courseExternalId: 'course-1',
        type: 'document',
        url: 'https://portal.com/file.pdf',
        fileName: 'file.pdf',
      }, 'cm-1'),
    ];
    downloadAssets.mockResolvedValue([
      {
        descriptor: {
          originalUrl: 'https://portal.com/file.pdf',
          fileName: 'file.pdf',
          entityType: 'courseMaterial',
          entityExternalId: 'cm-1',
          courseExternalId: 'course-1',
        },
        localPath: join(manifestDir, 'f'),
        contentHash: 'h1',
        fileSize: 100,
        skipped: false,
        etag: '"e1"',
        lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT',
      },
    ]);
    const uploadBatch = jest.fn().mockResolvedValue([
      {
        serverAssetId: 'asset-1',
        serverUrl: 'https://api.example.com/assets/asset-1',
        originalUrl: 'https://portal.com/file.pdf',
        contentHash: 'h1',
      },
    ]);
    AssetUploader.mockImplementation(() => ({ uploadBatch }));

    const result = await processAssets(ops, { ...baseConfig }, { ...baseContext });

    expect(downloadAssets).toHaveBeenCalled();
    expect(uploadBatch).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect((result[0] as ISlcDeltaOp).record).toEqual(
      expect.objectContaining({
        url: 'https://api.example.com/assets/asset-1',
        title: 'Doc',
        courseExternalId: 'course-1',
        type: 'document',
        fileName: 'file.pdf',
      }),
    );
  });

  it('should rewrite attachment URLs in assignment and message ops', async () => {
    const ops: ISlcDeltaOp[] = [
      makeOp('assignment', {
        title: 'A1',
        attachments: [
          { name: 'a.pdf', url: 'https://portal.com/a.pdf' },
          { name: 'b.pdf', url: 'https://portal.com/b.pdf' },
        ],
      }, 'a-1'),
    ];
    downloadAssets.mockResolvedValue([
      {
        descriptor: { originalUrl: 'https://portal.com/a.pdf', fileName: 'a.pdf', entityType: 'assignment', entityExternalId: 'a-1' },
        localPath: join(manifestDir, 'a'),
        contentHash: 'ha',
        fileSize: 1,
        skipped: false,
      },
      {
        descriptor: { originalUrl: 'https://portal.com/b.pdf', fileName: 'b.pdf', entityType: 'assignment', entityExternalId: 'a-1' },
        localPath: join(manifestDir, 'b'),
        contentHash: 'hb',
        fileSize: 1,
        skipped: false,
      },
    ]);
    const uploadBatch = jest.fn().mockResolvedValue([
      { serverAssetId: 'id-a', serverUrl: 'https://api.example.com/assets/id-a', originalUrl: 'https://portal.com/a.pdf', contentHash: 'ha' },
      { serverAssetId: 'id-b', serverUrl: 'https://api.example.com/assets/id-b', originalUrl: 'https://portal.com/b.pdf', contentHash: 'hb' },
    ]);
    AssetUploader.mockImplementation(() => ({ uploadBatch }));

    const result = await processAssets(ops, baseConfig, baseContext);

    const rec = (result[0] as ISlcDeltaOp).record as { attachments?: { name: string; url?: string }[] };
    expect(rec.attachments).toHaveLength(2);
    expect(rec.attachments?.[0]?.url).toBe('https://api.example.com/assets/id-a');
    expect(rec.attachments?.[1]?.url).toBe('https://api.example.com/assets/id-b');
  });
});

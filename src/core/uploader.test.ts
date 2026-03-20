import { ScholaracleUploader } from './uploader';
import {
  SLC_INGEST_SCHEMA_VERSION_V1,
  type ISlcIngestEnvelopeV1,
} from '@scholaracle/contracts';

function makeEnvelope(runId = 'run-1'): ISlcIngestEnvelopeV1 {
  return {
    schemaVersion: SLC_INGEST_SCHEMA_VERSION_V1,
    run: {
      runId,
      startedAt: '2026-02-16T12:00:00Z',
      provider: 'test',
      adapterId: 'com.test.adapter',
      adapterVersion: '1.0.0',
      mode: 'delta',
      timezone: 'America/Chicago',
    },
    source: { sourceId: 'src-1', displayName: 'Test' },
    ops: [
      {
        op: 'upsert', entity: 'assignment',
        key: { provider: 'test', adapterId: 'com.test.adapter', externalId: 'a-1', studentExternalId: 'stu-1', institutionExternalId: 'inst-1' },
        observedAt: '2026-02-16T12:00:00Z',
        record: { title: 'HW 1' },
      },
    ],
  };
}

// Mock axios at the module level
let mockPost: jest.Mock;
jest.mock('axios', () => ({
  create: () => ({
    post: (...args: unknown[]) => mockPost(...args),
  }),
}));

beforeEach(() => {
  mockPost = jest.fn();
});

describe('ScholaracleUploader', () => {
  describe('constructor', () => {
    it('should create uploader with base URL and token', () => {
      const uploader = new ScholaracleUploader('https://api.scholarmancy.com', 'tok-123');
      expect(uploader).toBeDefined();
    });
  });

  describe('upload()', () => {
    it('should execute the full upload flow: start run -> upload envelope -> complete', async () => {
      const runId = 'run-test-1';
      mockPost
        .mockResolvedValueOnce({ data: { success: true, runId, mode: 'delta' } })
        .mockResolvedValueOnce({ data: { success: true, accepted: true } })
        .mockResolvedValueOnce({ data: { success: true, committed: true } });

      const uploader = new ScholaracleUploader('https://api.scholarmancy.com', 'tok-123');
      const result = await uploader.upload(makeEnvelope(runId));

      expect(result.success).toBe(true);
      expect(mockPost).toHaveBeenCalledTimes(3);

      // start run
      expect(mockPost.mock.calls[0][0]).toBe('/api/ingest/v1/runs');
      // upload envelope
      expect(mockPost.mock.calls[1][0]).toBe(`/api/ingest/v1/runs/${runId}/envelope`);
      // complete
      expect(mockPost.mock.calls[2][0]).toBe(`/api/ingest/v1/runs/${runId}/complete`);
    });

    it('should return error if start-run fails', async () => {
      mockPost.mockRejectedValueOnce(new Error('Network error'));

      const uploader = new ScholaracleUploader('https://api.scholarmancy.com', 'tok-123');
      const result = await uploader.upload(makeEnvelope());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should return error if envelope upload fails', async () => {
      mockPost
        .mockResolvedValueOnce({ data: { success: true, runId: 'run-1', mode: 'delta' } })
        .mockRejectedValueOnce(new Error('400 Bad Request'));

      const uploader = new ScholaracleUploader('https://api.scholarmancy.com', 'tok-123');
      const result = await uploader.upload(makeEnvelope());

      expect(result.success).toBe(false);
      expect(result.error).toContain('400 Bad Request');
    });

    it('should pass sourceId in start-run request', async () => {
      mockPost
        .mockResolvedValueOnce({ data: { success: true, runId: 'run-1', mode: 'delta' } })
        .mockResolvedValueOnce({ data: { success: true, accepted: true } })
        .mockResolvedValueOnce({ data: { success: true, committed: true } });

      const uploader = new ScholaracleUploader('https://api.scholarmancy.com', 'tok-123');
      await uploader.upload(makeEnvelope());

      expect(mockPost.mock.calls[0][1]).toEqual({ sourceId: 'src-1' });
    });
  });

  describe('validate()', () => {
    it('should call the validate endpoint', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, validated: true } });

      const uploader = new ScholaracleUploader('https://api.scholarmancy.com', 'tok-123');
      const result = await uploader.validate(makeEnvelope());

      expect(result.valid).toBe(true);
      expect(mockPost.mock.calls[0][0]).toBe('/api/ingest/v1/validate');
    });

    it('should return error on validation failure', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: false, error: 'Invalid schemaVersion' } });

      const uploader = new ScholaracleUploader('https://api.scholarmancy.com', 'tok-123');
      const result = await uploader.validate(makeEnvelope());

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid schemaVersion');
    });
  });
});

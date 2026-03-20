import axios, { type AxiosInstance } from 'axios';
import type { ISlcIngestEnvelopeV1 } from '@scholaracle/contracts';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface UploadResult {
  readonly success: boolean;
  readonly runId?: string;
  readonly error?: string;
}

export interface ValidateResult {
  readonly valid: boolean;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Uploader
// ---------------------------------------------------------------------------

/**
 * Client for the Scholaracle Ingest API.
 *
 * Handles the full upload lifecycle:
 * 1. POST /runs — start a new ingestion run
 * 2. POST /runs/:runId/envelope — upload the data envelope
 * 3. POST /runs/:runId/complete — commit the run (triggers alert generation)
 */
export class ScholaracleUploader {
  private readonly client: AxiosInstance;

  constructor(baseUrl: string, connectorToken: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${connectorToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  async upload(envelope: ISlcIngestEnvelopeV1): Promise<UploadResult> {
    try {
      // Step 1: Start run
      const startRes = await this.client.post('/api/ingest/v1/runs', {
        sourceId: envelope.source.sourceId,
      });
      const runId = startRes.data.runId as string;

      // Step 2: Upload envelope (use the server-assigned runId)
      const envelopeWithRunId = {
        ...envelope,
        run: { ...envelope.run, runId },
      };
      await this.client.post(`/api/ingest/v1/runs/${runId}/envelope`, envelopeWithRunId);

      // Step 3: Complete run
      await this.client.post(`/api/ingest/v1/runs/${runId}/complete`, {});

      return { success: true, runId };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  async validate(envelope: ISlcIngestEnvelopeV1): Promise<ValidateResult> {
    try {
      const res = await this.client.post('/api/ingest/v1/validate', envelope);
      if (res.data.validated) {
        return { valid: true };
      }
      return { valid: false, error: res.data.error ?? 'Validation failed' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { valid: false, error: message };
    }
  }
}

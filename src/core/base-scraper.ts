import { randomUUID } from 'node:crypto';
import {
  SLC_INGEST_SCHEMA_VERSION_V1,
  type ISlcDeltaOp,
  type ISlcIngestEnvelopeV1,
  type IStrategyStore,
} from '@scholaracle/contracts';
import type {
  IDiscoveredStudent,
  IScraperConfig,
  IScraperMetadata,
  ScraperPhase,
  ScraperProgressCallback,
} from './scraper-types';
import { processAssets } from './asset-manager';

/**
 * Abstract base class for all Scholaracle scrapers.
 *
 * Subclasses implement the platform-specific methods:
 * - initialize() — set up the browser/client
 * - authenticate() — log into the school portal
 * - scrape() — extract raw data from the platform
 * - transform() — convert raw data into ISlcDeltaOp[]
 * - cleanup() — close browser/resources
 *
 * For multi-student portals (one login → many kids), override:
 * - discoverStudents() — return list of students after login
 * - switchToStudent(externalId) — select that student in the UI
 *
 * The base class provides run() which orchestrates the full lifecycle
 * and assembleEnvelope() which wraps ops in an ISlcIngestEnvelopeV1.
 *
 * Override getRequestHeaders() to pass cookies for authenticated asset downloads.
 */
export interface IRunOptions {
  readonly apiBaseUrl?: string;
  readonly connectorToken?: string;
  readonly onProgress?: ScraperProgressCallback;
}

export abstract class BaseScraper {
  public config: IScraperConfig | undefined;

  /** Optional strategy store for caching extraction paths. Set by CLI or runner. */
  public strategyStore: IStrategyStore | undefined;

  private _onProgress: ScraperProgressCallback | undefined;
  private _phaseStart = 0;

  protected emitProgress(phase: ScraperPhase, message: string, detail?: Record<string, unknown>): void {
    const now = Date.now();
    const durationMs = this._phaseStart > 0 ? now - this._phaseStart : undefined;
    this._phaseStart = now;
    this._onProgress?.({
      phase,
      message,
      timestamp: new Date(now).toISOString(),
      durationMs,
      detail,
    });
  }

  abstract get metadata(): IScraperMetadata;

  abstract initialize(config: IScraperConfig): Promise<void>;

  abstract authenticate(): Promise<{ success: boolean; message?: string }>;

  abstract scrape(): Promise<Record<string, unknown>>;

  abstract transform(rawData: Record<string, unknown>): ISlcDeltaOp[];

  abstract cleanup(): Promise<void>;

  /**
   * Discover students available after login (e.g. from a student selector).
   * Default: single student using config.studentExternalId / studentName or studentNameHint.
   */
  async discoverStudents(): Promise<IDiscoveredStudent[]> {
    const rawId = this.config?.studentExternalId;
    const id = (typeof rawId === 'string' && rawId.trim()) ? rawId.trim() : 'default';
    const name =
      (this.config?.studentName?.trim()) ||
      this.config?.credentials?.studentNameHint?.trim() ||
      'Default';
    return [{ externalId: id, displayName: name }];
  }

  /**
   * Switch the UI to the given student (e.g. select from dropdown).
   * Default: no-op (single-student or already on the right context).
   */
  async switchToStudent(_externalId: string): Promise<void> {
    // no-op
  }

  /**
   * Return headers (e.g. Cookie) for authenticated asset downloads. Override in Playwright scrapers.
   */
  async getRequestHeaders(): Promise<Record<string, string>> {
    return {};
  }

  /**
   * Execute the full scraper lifecycle and return a validated envelope.
   * When runOptions.apiBaseUrl and runOptions.connectorToken are set, downloads assets and rewrites URLs.
   * Guarantees cleanup() is called even if an error occurs.
   */
  async run(config: IScraperConfig, runOptions?: IRunOptions): Promise<ISlcIngestEnvelopeV1> {
    this._onProgress = runOptions?.onProgress;
    this._phaseStart = Date.now();
    const startedAt = new Date().toISOString();
    const runId = randomUUID();

    try {
      this.emitProgress('initializing', 'Launching browser and loading portal...');
      await this.initialize(config);

      this.emitProgress('authenticating', 'Logging in to school portal...');
      const authResult = await this.authenticate();
      if (!authResult.success) {
        this.emitProgress('failed', `Authentication failed: ${authResult.message ?? 'unknown reason'}`);
        throw new Error(`Authentication failed: ${authResult.message ?? 'unknown reason'}`);
      }

      this.emitProgress('scraping', 'Extracting data from portal pages...');
      const rawData = await this.scrape();

      this.emitProgress('transforming', 'Converting raw data to normalized format...');
      let ops = this.transform(rawData);
      this.emitProgress('transforming', `Produced ${ops.length} operations`, {
        opCount: ops.length,
        entityTypes: [...new Set(ops.map(o => o.entity))],
      });

      if (
        runOptions?.apiBaseUrl &&
        runOptions?.connectorToken &&
        !config.options?.skipDownloads
      ) {
        this.emitProgress('processing_assets', 'Downloading and uploading file assets...');
        try {
          const requestHeaders = await this.getRequestHeaders();
          ops = await processAssets(ops, config, {
            apiBaseUrl: runOptions.apiBaseUrl,
            connectorToken: runOptions.connectorToken,
            requestHeaders: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
            runId,
          });
        } catch (assetErr: unknown) {
          const msg = assetErr instanceof Error ? assetErr.message : String(assetErr);
          this.emitProgress('processing_assets', `Asset processing failed — continuing with original URLs: ${msg}`);
        }
      }

      const envelope: ISlcIngestEnvelopeV1 = {
        schemaVersion: SLC_INGEST_SCHEMA_VERSION_V1,
        run: {
          runId,
          startedAt,
          endedAt: new Date().toISOString(),
          provider: config.provider,
          adapterId: config.adapterId,
          adapterVersion: this.metadata.version,
          mode: 'delta',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        source: {
          sourceId: config.sourceId,
          displayName: this.metadata.name,
          portalBaseUrl: config.credentials.baseUrl,
        },
        ops,
      };

      this.emitProgress('completed', `Run complete — ${ops.length} ops in envelope`, {
        runId,
        opCount: ops.length,
        totalDurationMs: Date.now() - new Date(startedAt).getTime(),
      });

      return envelope;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitProgress('failed', msg);
      throw err;
    } finally {
      this.emitProgress('cleanup', 'Closing browser...');
      await this.cleanup();
    }
  }

  /**
   * Wrap an array of ops in an ISlcIngestEnvelopeV1.
   * Useful for testing or manual envelope construction.
   */
  assembleEnvelope(ops: ISlcDeltaOp[]): ISlcIngestEnvelopeV1 {
    if (!this.config) {
      throw new Error('Cannot assemble envelope without config. Call initialize() first.');
    }

    return {
      schemaVersion: SLC_INGEST_SCHEMA_VERSION_V1,
      run: {
        runId: randomUUID(),
        startedAt: new Date().toISOString(),
        provider: this.config.provider,
        adapterId: this.config.adapterId,
        adapterVersion: this.metadata.version,
        mode: 'delta',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      source: {
        sourceId: this.config.sourceId,
        displayName: this.metadata.name,
        portalBaseUrl: this.config.credentials.baseUrl,
      },
      ops,
    };
  }
}

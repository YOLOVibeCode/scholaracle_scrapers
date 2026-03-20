/**
 * Scraper-specific types — configuration, progress, and asset management.
 *
 * Ingest envelope types (ISlcDeltaOp, ISlcIngestEnvelopeV1, etc.) are
 * imported from @scholaracle/contracts — the single canonical source.
 */

// ---------------------------------------------------------------------------
// Scraper progress / status reporting
// ---------------------------------------------------------------------------

export type ScraperPhase =
  | 'initializing'
  | 'authenticating'
  | 'discovering_students'
  | 'switching_student'
  | 'scraping'
  | 'transforming'
  | 'processing_assets'
  | 'validating'
  | 'uploading'
  | 'cleanup'
  | 'completed'
  | 'failed';

export interface IScraperProgress {
  readonly phase: ScraperPhase;
  readonly message: string;
  readonly timestamp: string;
  readonly durationMs?: number;
  readonly detail?: Record<string, unknown>;
}

export type ScraperProgressCallback = (progress: IScraperProgress) => void;

// ---------------------------------------------------------------------------
// Scraper configuration types
// ---------------------------------------------------------------------------

export interface IScraperMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author?: string;
  readonly description: string;
  readonly platforms: readonly string[];
  readonly capabilities: {
    readonly grades: boolean;
    readonly assignments: boolean;
    readonly attendance: boolean;
    readonly schedule: boolean;
    readonly messages: boolean;
    readonly documents: boolean;
  };
}

export interface IScraperCredentials {
  readonly baseUrl: string;
  readonly username?: string;
  readonly password?: string;
  readonly accessToken?: string;
  readonly loginMethod?: 'direct' | 'google_sso' | 'clever_sso' | 'other_sso';
  /** Optional hint when the portal shows one student (single-student portals). */
  readonly studentNameHint?: string;
}

/** Result of discoverStudents() for connection-centric scrapers (e.g. one login → many kids). */
export interface IDiscoveredStudent {
  readonly externalId: string;
  readonly displayName?: string;
}

export interface IScraperConfig {
  readonly credentials: IScraperCredentials;
  readonly studentName: string;
  readonly studentExternalId: string;
  readonly institutionExternalId: string;
  readonly sourceId: string;
  readonly provider: string;
  readonly adapterId: string;
  readonly options?: {
    readonly headless?: boolean;
    readonly timeout?: number;
    readonly retries?: number;
    readonly skipDownloads?: boolean;
    readonly maxConcurrentDownloads?: number;
    readonly assetSizeLimit?: number;
  };
}

// ---------------------------------------------------------------------------
// Asset management types
// ---------------------------------------------------------------------------

export interface IAssetDescriptor {
  readonly originalUrl: string;
  readonly fileName: string;
  readonly mimeType?: string;
  readonly fileSize?: number;
  readonly entityType: 'courseMaterial' | 'assignment' | 'message';
  readonly entityExternalId: string;
  readonly courseExternalId?: string;
  /** Term (semester/quarter/grading period) the subject belongs to; used for term-based pruning. */
  readonly academicTermId?: string;
}

export interface IAssetManifestEntry {
  readonly originalUrl: string;
  readonly contentHash: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly serverAssetId: string;
  readonly serverUrl: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly uploadedAt: string;
  readonly academicTermId?: string;
}

export interface IAssetManifest {
  readonly sourceId: string;
  readonly provider: string;
  readonly lastUpdated: string;
  readonly entries: Record<string, IAssetManifestEntry>;
}

export interface IDownloadResult {
  readonly descriptor: IAssetDescriptor;
  readonly localPath: string;
  readonly contentHash: string;
  readonly fileSize: number;
  readonly skipped: boolean;
  readonly cachedServerUrl?: string;
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface IUploadedAsset {
  readonly serverAssetId: string;
  readonly serverUrl: string;
  readonly originalUrl: string;
  readonly contentHash: string;
}

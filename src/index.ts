/**
 * Scholaracle Scraper Library — public API.
 *
 * Exports scraper classes, configuration types, and utilities
 * for both CLI and server-side usage.
 */

// Core
export { BaseScraper, type IRunOptions } from './core/base-scraper';
export { ScholaracleUploader } from './core/uploader';
export { FileStrategyStore } from './core/file-strategy-store';
export { createScraper, registerScraper, getRegisteredPlatforms } from './core/scraper-registry';

// Scraper-specific types
export type {
  IScraperConfig,
  IScraperMetadata,
  IScraperCredentials,
  IDiscoveredStudent,
  ScraperPhase,
  ScraperProgressCallback,
  IScraperProgress,
  IAssetDescriptor,
  IAssetManifestEntry,
  IAssetManifest,
  IDownloadResult,
  IUploadedAsset,
} from './core/scraper-types';

// Scraper implementations
export { CanvasScraper } from './scrapers/canvas/canvas-scraper';
export { SkywardScraper } from './scrapers/skyward/skyward-scraper';
export { AeriesScraper } from './scrapers/aeries/aeries-scraper';

// Re-export ingest types from contracts for convenience
export type {
  ISlcDeltaOp,
  ISlcIngestEnvelopeV1,
  ISlcEntityKey,
  SlcEntityType,
  IStrategyStore,
} from '@scholaracle/contracts';

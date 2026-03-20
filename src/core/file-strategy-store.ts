/**
 * File-based strategy store for local CLI. Writes to strategies/ subdir.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { IExtractionStrategy, IStrategyStore } from '@scholaracle/contracts';

const STRATEGIES_DIR = 'strategies';

function safeFilename(extractionId: string): string {
  return extractionId.replace(/[:/\\]/g, '_') + '.json';
}

export class FileStrategyStore implements IStrategyStore {
  private readonly baseDir: string;

  constructor(configDir: string) {
    this.baseDir = join(configDir, STRATEGIES_DIR);
  }

  async get(extractionId: string): Promise<IExtractionStrategy | null> {
    const path = join(this.baseDir, safeFilename(extractionId));
    if (!existsSync(path)) return null;
    try {
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw) as IExtractionStrategy;
    } catch {
      return null;
    }
  }

  async save(strategy: IExtractionStrategy): Promise<void> {
    mkdirSync(this.baseDir, { recursive: true });
    const path = join(this.baseDir, safeFilename(strategy.extractionId));
    writeFileSync(path, JSON.stringify(strategy, null, 2), 'utf-8');
  }

  async invalidate(extractionId: string): Promise<void> {
    const path = join(this.baseDir, safeFilename(extractionId));
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}

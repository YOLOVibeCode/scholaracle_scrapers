import { AssetManifest } from '../core/asset-manifest';

/**
 * Prune asset manifest entries for a source (optionally by academic term).
 * Removes entries from the local manifest only; server-side pruning is separate.
 */
export async function pruneCommand(sourceId: string, options?: { term?: string }): Promise<void> {
  const manifest = new AssetManifest();
  const loaded = await manifest.loadFromFile(sourceId);
  if (!loaded) {
    console.error(`  ✗ No asset manifest found for source: ${sourceId}`);
    process.exit(1);
  }
  const termId = options?.term;
  if (termId) {
    manifest.pruneByTerm(termId);
  }
  await manifest.save();
  const count = Object.keys(manifest.getEntries()).length;
  console.log(`  ✓ Pruned manifest for ${sourceId}${termId ? ` (term: ${termId})` : ''}. ${count} entries remaining.`);
}

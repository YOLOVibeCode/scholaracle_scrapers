import { homedir } from 'node:os';

/**
 * Canonical inventory of every environment variable the codebase reads.
 * Add new entries here when introducing a new env var dependency.
 */
export const ENV_KEYS = Object.freeze([
  'CANVAS_BASE_URL',
  'CANVAS_USERNAME',
  'CANVAS_PASSWORD',
  'SKYWARD_BASE_URL',
  'SKYWARD_USERNAME',
  'SKYWARD_PASSWORD',
  'ANTHROPIC_API_KEY',
  'NOCTUSOFT_API_KEY',
  'HOME',
] as const);

export type EnvKey = (typeof ENV_KEYS)[number];

function sanitize(raw: string): string | undefined {
  const cleaned = raw.replace(/[\r\n]/g, '').trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Read an environment variable with sanitization (strips newlines + whitespace).
 * Returns the fallback (or undefined) when the var is missing or empty after sanitization.
 */
export function getEnv(key: string, fallback?: string): string | undefined {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return sanitize(raw) ?? fallback;
}

/**
 * Read a required environment variable. Throws if missing or empty after sanitization.
 */
export function getRequiredEnv(key: string): string {
  const value = getEnv(key);
  if (value === undefined) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Returns the user's home directory, sanitized.
 * Falls back to os.homedir() when HOME is unset.
 */
export function getHomeDir(): string {
  return getEnv('HOME') ?? homedir();
}

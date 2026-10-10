/**
 * Model keys that were retired from the selectable registry, mapped to the key
 * that replaces them. Shared by the browser (saved settings, stored recordings)
 * and the server (old clients, stale environment variables).
 */
export const LEGACY_MODEL_KEYS: Readonly<Record<string, string>> = {
  'google:gemini-3.1-flash-lite': 'google:gemini-3.5-flash-lite',
};

export function canonicalModelKey(key: string): string;
export function canonicalModelKey(key: string | undefined): string | undefined;
export function canonicalModelKey(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  return Object.prototype.hasOwnProperty.call(LEGACY_MODEL_KEYS, key) ? LEGACY_MODEL_KEYS[key] : key;
}

/**
 * Registry of cache-clearing callbacks.
 *
 * Adapters register on module load, so `clearCaches()` is synchronous and only touches
 * adapters that were actually imported. A lazily-loaded adapter has no cache to clear.
 *
 * @type {Set<() => void>}
 */
const clearers = new Set();

/**
 * Register a cache-clearing callback.
 * @param {() => void} fn
 */
export function registerCache(fn) {
  clearers.add(fn);
}

/** Invoke every registered cache-clearing callback. */
export function clearCaches() {
  for (const fn of clearers) fn();
}

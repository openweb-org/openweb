import type { CaptureData } from './classify.js'

/**
 * Detect sapisidhash signing: Authorization header matches
 * `SAPISIDHASH <timestamp>_<40-char-hex>` pattern.
 */
export function detectSapisidhash(data: CaptureData): { origin: string } | undefined {
  for (const entry of data.harEntries) {
    for (const h of entry.request.headers) {
      if (h.name.toLowerCase() === 'authorization' && /^SAPISIDHASH \d+_[0-9a-f]{40}$/.test(h.value)) {
        try {
          const origin = new URL(entry.request.url).origin
          return { origin }
        } catch {
          // URL parse failed — skip
        }
      }
    }
  }
  return undefined
}

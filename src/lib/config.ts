/**
 * Centralized runtime configuration.
 * All values fall back to sensible defaults and can be overridden via env vars.
 */

// ── CDP ──────────────────────────────────────────

export const CDP_PORT = process.env.OPENWEB_CDP_PORT ?? '9222'
export const CDP_ENDPOINT = `http://localhost:${CDP_PORT}`

// ── User-Agent ───────────────────────────────────

export const DEFAULT_USER_AGENT =
  process.env.OPENWEB_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// ── Timeouts (ms) ────────────────────────────────

export const TIMEOUT = {
  /** CDP readiness polling timeout */
  cdpReady: 10_000,
  /** WebSocket request/reply timeout */
  ws: 10_000,
  /** Probe fetch timeout */
  probe: 5_000,
  /** Delay between probe requests */
  probeDelay: 500,
  /** Page navigation timeout */
  navigation: 30_000,
  /** Adapter init retry delay */
  adapterRetry: 500,
  /** AsyncAPI generator default timeout */
  asyncapiDefault: 10_000,
  /** Recording script child process timeout */
  recording: Number(process.env.OPENWEB_RECORDING_TIMEOUT ?? 120_000),
} as const

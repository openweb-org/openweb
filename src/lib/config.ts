/**
 * Centralized runtime configuration.
 * All values derive from loadConfig() which reads $OPENWEB_HOME/config.json.
 * OPENWEB_HOME is the sole env var — everything else comes from config.json or defaults.
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { PermissionCategory } from '../types/extensions.js'

// ── Data directory ──────────────────────────────

/** Root data directory. Override with OPENWEB_HOME env var. Defaults to ~/.openweb. */
export function openwebHome(): string {
  return process.env.OPENWEB_HOME ?? path.join(os.homedir(), '.openweb')
}

// ── Unified config ──────────────────────────────

type ConfigPolicy = 'allow' | 'prompt' | 'deny'

export interface OpenWebConfig {
  readonly browser?: {
    readonly headless?: boolean
    readonly port?: number
    readonly profile?: string
  }
  readonly userAgent?: string
  readonly timeout?: number
  readonly recordingTimeout?: number
  readonly debug?: boolean
  readonly permissions?: {
    readonly defaults?: Partial<Record<PermissionCategory, ConfigPolicy>>
    readonly sites?: Record<string, Partial<Record<PermissionCategory, ConfigPolicy>>>
  }
}

// ── Chrome version detection ────────────────────

const FALLBACK_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'

/** Detect installed Chrome version without launching the browser. */
export function detectChromeVersion(): string | null {
  const osName = os.platform()
  try {
    if (osName === 'darwin') {
      const version = execSync(
        '/usr/libexec/PlistBuddy -c "Print :KSVersion" "/Applications/Google Chrome.app/Contents/Info.plist"',
        { encoding: 'utf8', timeout: 1000 },
      ).trim()
      return version || null
    }
    if (osName === 'linux') {
      const output = execSync('google-chrome --version', { encoding: 'utf8', timeout: 2000 }).trim()
      const match = output.match(/(\d+\.\d+\.\d+\.\d+)/)
      return match?.[1] ?? null
    }
  } catch {
    // Chrome not installed or detection failed — use fallback
  }
  return null
}

/** Build a User-Agent string from a Chrome version. */
function buildUserAgent(chromeVersion: string): string {
  const osName = os.platform()
  const osString =
    osName === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : osName === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${osString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
}

const _detectedVersion = detectChromeVersion()
const _autoUA = _detectedVersion ? buildUserAgent(_detectedVersion) : FALLBACK_UA

const DEFAULT_CONFIG: OpenWebConfig = {
  browser: { headless: true, port: 9222 },
  userAgent: _autoUA,
  timeout: 30_000,
  recordingTimeout: 120_000,
  debug: false,
}

let cachedConfig: OpenWebConfig | undefined

/** Validate raw JSON and return a cleaned OpenWebConfig (unknown fields ignored). */
function validateConfig(raw: unknown): OpenWebConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
  const result: Record<string, unknown> = {}

  // browser
  if (obj.browser && typeof obj.browser === 'object' && !Array.isArray(obj.browser)) {
    const b = obj.browser as Record<string, unknown>
    const browser: Record<string, unknown> = {}
    if (typeof b.headless === 'boolean') browser.headless = b.headless
    if (typeof b.port === 'number' && Number.isFinite(b.port) && b.port > 0 && b.port <= 65535) browser.port = b.port
    if (typeof b.profile === 'string') browser.profile = b.profile
    if (Object.keys(browser).length > 0) result.browser = browser
  }

  // scalar fields
  if (typeof obj.userAgent === 'string') result.userAgent = obj.userAgent
  if (typeof obj.timeout === 'number' && Number.isFinite(obj.timeout) && obj.timeout > 0) result.timeout = obj.timeout
  if (typeof obj.recordingTimeout === 'number' && Number.isFinite(obj.recordingTimeout) && obj.recordingTimeout > 0)
    result.recordingTimeout = obj.recordingTimeout
  if (typeof obj.debug === 'boolean') result.debug = obj.debug

  // permissions
  if (obj.permissions && typeof obj.permissions === 'object' && !Array.isArray(obj.permissions)) {
    const p = obj.permissions as Record<string, unknown>
    const validPolicies = new Set(['allow', 'prompt', 'deny'])
    const validCategories = new Set(['read', 'write', 'delete', 'transact'])
    const permissions: Record<string, unknown> = {}

    if (p.defaults && typeof p.defaults === 'object' && !Array.isArray(p.defaults)) {
      const defaults: Record<string, string> = {}
      for (const [k, v] of Object.entries(p.defaults as Record<string, unknown>)) {
        if (validCategories.has(k) && typeof v === 'string' && validPolicies.has(v)) defaults[k] = v
      }
      if (Object.keys(defaults).length > 0) permissions.defaults = defaults
    }

    if (p.sites && typeof p.sites === 'object' && !Array.isArray(p.sites)) {
      const sites: Record<string, Record<string, string>> = {}
      for (const [siteName, overrides] of Object.entries(p.sites as Record<string, unknown>)) {
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) continue
        const siteOverrides: Record<string, string> = {}
        for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
          if (validCategories.has(k) && typeof v === 'string' && validPolicies.has(v)) siteOverrides[k] = v
        }
        if (Object.keys(siteOverrides).length > 0) sites[siteName] = siteOverrides
      }
      if (Object.keys(sites).length > 0) permissions.sites = sites
    }

    if (Object.keys(permissions).length > 0) result.permissions = permissions
  }

  return result as OpenWebConfig
}

/**
 * Load unified config from `$OPENWEB_HOME/config.json`.
 * Returns hardcoded defaults merged with file contents.
 * Cached after first call (module-level singleton).
 *
 * - Missing file → returns defaults silently.
 * - Malformed JSON → warns to stderr, returns defaults.
 */
export function loadConfig(): OpenWebConfig {
  if (cachedConfig) return cachedConfig

  const filePath = path.join(openwebHome(), 'config.json')
  let fileConfig: OpenWebConfig = {}

  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    fileConfig = validateConfig(parsed)
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      // File missing — silent, use defaults
    } else {
      // Malformed JSON or other read error — warn to stderr
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[openweb:warn] failed to load config ${filePath}: ${msg}\n`)
    }
  }

  cachedConfig = {
    browser: { ...DEFAULT_CONFIG.browser, ...fileConfig.browser },
    userAgent: fileConfig.userAgent ?? DEFAULT_CONFIG.userAgent,
    timeout: fileConfig.timeout ?? DEFAULT_CONFIG.timeout,
    recordingTimeout: fileConfig.recordingTimeout ?? DEFAULT_CONFIG.recordingTimeout,
    debug: fileConfig.debug ?? DEFAULT_CONFIG.debug,
    ...(fileConfig.permissions ? { permissions: fileConfig.permissions } : {}),
  }

  return cachedConfig
}

// ── Derived exports ─────────────────────────────
// All values derive from loadConfig() — no direct env var reads.

const _cfg = loadConfig()

export const CDP_PORT = String(_cfg.browser?.port ?? 9222)
export const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}`

export const DEFAULT_USER_AGENT = _cfg.userAgent ?? _autoUA

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
  recording: _cfg.recordingTimeout ?? 120_000,
  /** SPA settle wait after navigation (redirects, hydration) */
  spaSettle: 2_000,
  /** Webpack module walk settle — longer for heavy bundle init */
  moduleWalkSettle: 3_000,
} as const

// ── Browser config helper ────────────────────────

/** Merged browser defaults from config.json. CLI flags override at call sites. */
export function getBrowserConfig(): { headless: boolean; port: number; profile?: string } {
  const cfg = loadConfig()
  return {
    headless: cfg.browser?.headless ?? true,
    port: cfg.browser?.port ?? 9222,
    ...(cfg.browser?.profile ? { profile: cfg.browser.profile } : {}),
  }
}

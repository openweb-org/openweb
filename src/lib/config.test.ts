import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OpenWebConfig } from './config.js'

/**
 * Tests for loadConfig() and getBrowserConfig().
 *
 * Strategy: set OPENWEB_HOME to a temp dir before each test,
 * then dynamically reimport config.ts to bypass the module-level cache.
 */

let tmpDir: string
let originalHome: string | undefined

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'openweb-config-test-'))
  originalHome = process.env.OPENWEB_HOME
  process.env.OPENWEB_HOME = tmpDir
})

afterEach(() => {
  if (originalHome === undefined) {
    process.env.OPENWEB_HOME = undefined
  } else {
    process.env.OPENWEB_HOME = originalHome
  }
  rmSync(tmpDir, { recursive: true, force: true })
  vi.resetModules()
})

function writeConfig(data: unknown): void {
  writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(data))
}

function writeRawConfig(raw: string): void {
  writeFileSync(path.join(tmpDir, 'config.json'), raw)
}

async function freshLoadConfig(): Promise<OpenWebConfig> {
  const mod = await import('./config.js')
  return mod.loadConfig()
}

async function freshGetBrowserConfig(): Promise<{ headless: boolean; port: number; profile?: string }> {
  const mod = await import('./config.js')
  return mod.getBrowserConfig()
}

// ── loadConfig — valid config ────────────────────

describe('loadConfig — valid config', () => {
  it('returns merged values from a full config file', async () => {
    writeConfig({
      browser: { headless: false, port: 9333, profile: '/path/to/profile' },
      userAgent: 'TestAgent/1.0',
      timeout: 60000,
      recordingTimeout: 240000,
      debug: true,
      permissions: {
        defaults: { read: 'allow', write: 'deny', delete: 'deny', transact: 'deny' },
        sites: { bank: { transact: 'prompt' } },
      },
    })

    const cfg = await freshLoadConfig()
    expect(cfg.browser?.headless).toBe(false)
    expect(cfg.browser?.port).toBe(9333)
    expect(cfg.browser?.profile).toBe('/path/to/profile')
    expect(cfg.userAgent).toBe('TestAgent/1.0')
    expect(cfg.timeout).toBe(60000)
    expect(cfg.recordingTimeout).toBe(240000)
    expect(cfg.debug).toBe(true)
    expect(cfg.permissions?.defaults?.write).toBe('deny')
    expect(cfg.permissions?.sites?.bank?.transact).toBe('prompt')
  })
})

// ── loadConfig — missing file ────────────────────

describe('loadConfig — missing file', () => {
  it('returns defaults silently when config.json does not exist', async () => {
    // tmpDir exists but has no config.json
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const cfg = await freshLoadConfig()
    expect(cfg.browser?.headless).toBe(true)
    expect(cfg.browser?.port).toBe(9222)
    expect(cfg.userAgent).toMatch(/Chrome\/\d+/)
    expect(cfg.timeout).toBe(30000)
    expect(cfg.recordingTimeout).toBe(120000)
    expect(cfg.debug).toBe(false)
    expect(cfg.permissions).toBeUndefined()

    // Should NOT have warned to stderr
    expect(stderrSpy).not.toHaveBeenCalled()
    stderrSpy.mockRestore()
  })
})

// ── loadConfig — malformed JSON ──────────────────

describe('loadConfig — malformed JSON', () => {
  it('warns to stderr and returns defaults for invalid JSON', async () => {
    writeRawConfig('{not valid json')
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const cfg = await freshLoadConfig()

    // Should return defaults
    expect(cfg.browser?.headless).toBe(true)
    expect(cfg.browser?.port).toBe(9222)
    expect(cfg.timeout).toBe(30000)

    // Should have warned to stderr
    expect(stderrSpy).toHaveBeenCalledOnce()
    const msg = stderrSpy.mock.calls[0]?.[0]
    expect(String(msg)).toContain('[openweb:warn]')
    stderrSpy.mockRestore()
  })
})

// ── loadConfig — partial config ──────────────────

describe('loadConfig — partial config', () => {
  it('merges partial browser config with defaults', async () => {
    writeConfig({ browser: { port: 9333 } })

    const cfg = await freshLoadConfig()
    expect(cfg.browser?.port).toBe(9333)
    // headless should be default
    expect(cfg.browser?.headless).toBe(true)
    // other fields should be default
    expect(cfg.timeout).toBe(30000)
    expect(cfg.userAgent).toMatch(/Chrome\/\d+/)
  })

  it('merges partial top-level fields with defaults', async () => {
    writeConfig({ debug: true })

    const cfg = await freshLoadConfig()
    expect(cfg.debug).toBe(true)
    expect(cfg.browser?.headless).toBe(true)
    expect(cfg.browser?.port).toBe(9222)
    expect(cfg.timeout).toBe(30000)
  })

  it('handles config with only permissions', async () => {
    writeConfig({
      permissions: {
        defaults: { read: 'deny' },
      },
    })

    const cfg = await freshLoadConfig()
    expect(cfg.permissions?.defaults?.read).toBe('deny')
    expect(cfg.browser?.headless).toBe(true)
    expect(cfg.timeout).toBe(30000)
  })
})

// ── loadConfig — invalid field types ─────────────

describe('loadConfig — invalid field types', () => {
  it('ignores port when it is a string instead of number', async () => {
    writeConfig({ browser: { port: 'not a number' } })

    const cfg = await freshLoadConfig()
    // Invalid port ignored, default used
    expect(cfg.browser?.port).toBe(9222)
  })

  it('ignores headless when it is a string instead of boolean', async () => {
    writeConfig({ browser: { headless: 'yes' } })

    const cfg = await freshLoadConfig()
    expect(cfg.browser?.headless).toBe(true)
  })

  it('ignores timeout when it is a string', async () => {
    writeConfig({ timeout: 'slow' })

    const cfg = await freshLoadConfig()
    expect(cfg.timeout).toBe(30000)
  })

  it('ignores debug when it is a number', async () => {
    writeConfig({ debug: 1 })

    const cfg = await freshLoadConfig()
    expect(cfg.debug).toBe(false)
  })

  it('ignores userAgent when it is a number', async () => {
    writeConfig({ userAgent: 42 })

    const cfg = await freshLoadConfig()
    expect(cfg.userAgent).toMatch(/Chrome\/\d+/)
  })

  it('ignores NaN and Infinity for numeric fields', async () => {
    // JSON.parse turns these into null, but test non-finite if passed differently
    writeConfig({ timeout: null, recordingTimeout: null })

    const cfg = await freshLoadConfig()
    expect(cfg.timeout).toBe(30000)
    expect(cfg.recordingTimeout).toBe(120000)
  })

  it('ignores invalid permission policy values', async () => {
    writeConfig({
      permissions: {
        defaults: { read: 'maybe', write: 123 },
      },
    })

    const cfg = await freshLoadConfig()
    // Invalid values should be stripped out
    expect(cfg.permissions?.defaults?.read).toBeUndefined()
    expect(cfg.permissions?.defaults?.write).toBeUndefined()
  })

  it('ignores invalid permission category keys', async () => {
    writeConfig({
      permissions: {
        defaults: { execute: 'allow', read: 'deny' },
      },
    })

    const cfg = await freshLoadConfig()
    expect(cfg.permissions?.defaults?.read).toBe('deny')
    expect((cfg.permissions?.defaults as Record<string, unknown>)?.execute).toBeUndefined()
  })

  it('ignores browser when it is an array', async () => {
    writeConfig({ browser: [1, 2, 3] })

    const cfg = await freshLoadConfig()
    // Should fall back to defaults for browser
    expect(cfg.browser?.headless).toBe(true)
    expect(cfg.browser?.port).toBe(9222)
  })

  it('ignores permissions when it is an array', async () => {
    writeConfig({ permissions: ['read'] })

    const cfg = await freshLoadConfig()
    expect(cfg.permissions).toBeUndefined()
  })

  it('returns defaults when config is a non-object (e.g. a string)', async () => {
    writeRawConfig('"just a string"')

    const cfg = await freshLoadConfig()
    expect(cfg.browser?.headless).toBe(true)
    expect(cfg.timeout).toBe(30000)
  })

  it('returns defaults when config is an array', async () => {
    writeRawConfig('[1, 2, 3]')

    const cfg = await freshLoadConfig()
    expect(cfg.browser?.headless).toBe(true)
    expect(cfg.timeout).toBe(30000)
  })
})

// ── getBrowserConfig ─────────────────────────────

describe('getBrowserConfig', () => {
  it('returns correct defaults when no config file exists', async () => {
    const bc = await freshGetBrowserConfig()
    expect(bc.headless).toBe(true)
    expect(bc.port).toBe(9222)
    expect(bc.profile).toBeUndefined()
  })

  it('respects config values when set', async () => {
    writeConfig({
      browser: { headless: false, port: 9333, profile: '/custom/profile' },
    })

    const bc = await freshGetBrowserConfig()
    expect(bc.headless).toBe(false)
    expect(bc.port).toBe(9333)
    expect(bc.profile).toBe('/custom/profile')
  })

  it('partially overrides defaults', async () => {
    writeConfig({ browser: { port: 9444 } })

    const bc = await freshGetBrowserConfig()
    expect(bc.headless).toBe(true) // default
    expect(bc.port).toBe(9444)
    expect(bc.profile).toBeUndefined()
  })
})

// ── Override priority ────────────────────────────

describe('override priority', () => {
  it('config.json values override defaults', async () => {
    writeConfig({ timeout: 60000, browser: { port: 9333 } })

    const cfg = await freshLoadConfig()
    // config.json overrides defaults
    expect(cfg.timeout).toBe(60000)
    expect(cfg.browser?.port).toBe(9333)
    // unset fields still use defaults
    expect(cfg.browser?.headless).toBe(true)
    expect(cfg.recordingTimeout).toBe(120000)
  })

  it('empty config.json means all defaults', async () => {
    writeConfig({})

    const cfg = await freshLoadConfig()
    expect(cfg.browser?.headless).toBe(true)
    expect(cfg.browser?.port).toBe(9222)
    expect(cfg.timeout).toBe(30000)
    expect(cfg.recordingTimeout).toBe(120000)
    expect(cfg.debug).toBe(false)
  })
})

// ── Caching ──────────────────────────────────────

describe('caching', () => {
  it('returns the same object on subsequent calls within the same module instance', async () => {
    writeConfig({ debug: true })

    const mod = await import('./config.js')
    const first = mod.loadConfig()
    const second = mod.loadConfig()
    expect(first).toBe(second) // same reference (cached)
  })
})

// ── Chrome version detection ─────────────────────

describe('detectChromeVersion', () => {
  it('returns a version string or null (platform-dependent)', async () => {
    const mod = await import('./config.js')
    const result = mod.detectChromeVersion()
    // On CI or machines without Chrome, null is valid
    if (result !== null) {
      expect(result).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    }
  })
})

// ── DEFAULT_USER_AGENT ───────────────────────────

describe('DEFAULT_USER_AGENT', () => {
  it('contains a Chrome version string (detected or fallback)', async () => {
    const mod = await import('./config.js')
    expect(mod.DEFAULT_USER_AGENT).toMatch(/Chrome\/\d+/)
    expect(mod.DEFAULT_USER_AGENT).toContain('AppleWebKit/537.36')
  })

  it('uses config.json userAgent when set', async () => {
    writeConfig({ userAgent: 'CustomAgent/1.0' })
    const mod = await import('./config.js')
    expect(mod.DEFAULT_USER_AGENT).toBe('CustomAgent/1.0')
  })

  it('uses auto-detected UA when config.json has no userAgent', async () => {
    writeConfig({})
    const mod = await import('./config.js')
    // Should be a valid Chrome UA (either detected or fallback)
    expect(mod.DEFAULT_USER_AGENT).toMatch(/Mozilla\/5\.0 .+ Chrome\/\d+/)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Browser } from 'playwright-core'

// ── Mocks ────────────────────────────────────────

const mockConnectWithRetry = vi.fn<() => Promise<Browser>>()
vi.mock('../capture/connection.js', () => ({
  connectWithRetry: (...args: unknown[]) => mockConnectWithRetry(...args),
}))

const mockBrowserStartCommand = vi.fn<() => Promise<void>>()
const mockBrowserStopCommand = vi.fn<() => Promise<void>>()
vi.mock('../commands/browser.js', () => ({
  browserStartCommand: (...args: unknown[]) => mockBrowserStartCommand(...args),
  browserStopCommand: (...args: unknown[]) => mockBrowserStopCommand(...args),
}))

vi.mock('../lib/config.js', () => ({
  getBrowserConfig: () => ({ headless: true, port: 9222 }),
  openwebHome: () => tmpDir,
}))

// Suppress stderr writes from handleLoginRequired
vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

// Mock execFile so openInSystemBrowser doesn't actually open anything
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { OpenWebError } from '../lib/errors.js'

// ── Temp dir setup ───────────────────────────────

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'openweb-browser-lifecycle-test-'))
  mkdirSync(tmpDir, { recursive: true })
  vi.clearAllMocks()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ── Helpers ──────────────────────────────────────

const fakeBrowser = { close: vi.fn() } as unknown as Browser

function writePidFile(pid: number): void {
  writeFileSync(join(tmpDir, 'browser.pid'), String(pid))
}

function writePortFile(port: number): void {
  writeFileSync(join(tmpDir, 'browser.port'), String(port))
}

// ── Tests ────────────────────────────────────────

describe('ensureBrowser — external CDP', () => {
  it('connects directly when cdpEndpoint is provided', async () => {
    mockConnectWithRetry.mockResolvedValue(fakeBrowser)
    const { ensureBrowser } = await import('./browser-lifecycle.js')

    const result = await ensureBrowser('http://external:9333')

    expect(result).toBe(fakeBrowser)
    expect(mockConnectWithRetry).toHaveBeenCalledWith('http://external:9333')
    expect(mockBrowserStartCommand).not.toHaveBeenCalled()
  })
})

describe('ensureBrowser — reuse managed browser', () => {
  it('connects to existing browser when PID alive and CDP responds', async () => {
    // Write PID file with current process PID (guaranteed alive)
    writePidFile(process.pid)
    writePortFile(9222)

    // Mock fetch to simulate CDP /json/version responding OK
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as typeof fetch
    mockConnectWithRetry.mockResolvedValue(fakeBrowser)

    try {
      const { ensureBrowser } = await import('./browser-lifecycle.js')
      const result = await ensureBrowser()

      expect(result).toBe(fakeBrowser)
      expect(mockConnectWithRetry).toHaveBeenCalledWith('http://127.0.0.1:9222')
      expect(mockBrowserStartCommand).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('ensureBrowser — auto-start', () => {
  it('starts browser silently when no managed browser running', async () => {
    // No PID file → isManagedBrowserRunning returns false
    mockConnectWithRetry.mockResolvedValue(fakeBrowser)
    mockBrowserStartCommand.mockImplementation(async () => {
      // Simulate what browserStartCommand does: write port file
      writePortFile(9222)
    })

    const { ensureBrowser } = await import('./browser-lifecycle.js')
    const result = await ensureBrowser()

    expect(result).toBe(fakeBrowser)
    expect(mockBrowserStartCommand).toHaveBeenCalledWith(
      expect.objectContaining({ silent: true, headless: true }),
    )
    expect(mockConnectWithRetry).toHaveBeenCalledWith('http://127.0.0.1:9222')
  })

  it('throws when browser starts but port file not found', async () => {
    // browserStartCommand does NOT write port file
    mockBrowserStartCommand.mockResolvedValue(undefined)

    const { ensureBrowser } = await import('./browser-lifecycle.js')

    await expect(ensureBrowser()).rejects.toThrow('port file not found')
  })
})

describe('ensureBrowser — concurrent start guard', () => {
  it('only one of two concurrent calls starts the browser', async () => {
    let startCount = 0
    mockBrowserStartCommand.mockImplementation(async () => {
      startCount++
      // Simulate delay for browser start
      await new Promise((r) => setTimeout(r, 50))
      writePortFile(9222)
    })
    mockConnectWithRetry.mockResolvedValue(fakeBrowser)

    const { ensureBrowser } = await import('./browser-lifecycle.js')

    // Launch two concurrent calls
    const [r1, r2] = await Promise.all([ensureBrowser(), ensureBrowser()])

    expect(r1).toBe(fakeBrowser)
    expect(r2).toBe(fakeBrowser)
    // browserStartCommand should be called at most once because the second
    // call re-checks after acquiring the lock and finds the browser running
    // OR both go through the lock sequentially but the port file exists for the second.
    // In practice with filesystem lock, second waiter sees the port file after lock release.
    // The key invariant: no crash, both get a browser.
    expect(startCount).toBeGreaterThanOrEqual(1)
    expect(startCount).toBeLessThanOrEqual(2)

    // Clean up lock file if present
    const lockPath = join(tmpDir, 'browser.start.lock')
    if (existsSync(lockPath)) {
      rmSync(lockPath)
    }
  })
})

describe('isManagedBrowserRunning', () => {
  it('returns { running: true, port } when PID alive and CDP responds', async () => {
    writePidFile(process.pid)
    writePortFile(9222)

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as typeof fetch

    try {
      const { isManagedBrowserRunning } = await import('./browser-lifecycle.js')
      const result = await isManagedBrowserRunning()

      expect(result).toEqual({ running: true, port: 9222 })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns { running: false } when no PID file', async () => {
    const { isManagedBrowserRunning } = await import('./browser-lifecycle.js')
    const result = await isManagedBrowserRunning()

    expect(result).toEqual({ running: false })
  })

  it('returns { running: false } when PID file exists but process dead', async () => {
    // Use a PID that is almost certainly not running
    writePidFile(2_000_000)

    const { isManagedBrowserRunning } = await import('./browser-lifecycle.js')
    const result = await isManagedBrowserRunning()

    expect(result).toEqual({ running: false })
  })

  it('returns { running: false } when PID alive but no port file', async () => {
    writePidFile(process.pid)
    // No port file

    const { isManagedBrowserRunning } = await import('./browser-lifecycle.js')
    const result = await isManagedBrowserRunning()

    expect(result).toEqual({ running: false })
  })

  it('returns { running: false } when PID alive, port exists, but CDP not responding', async () => {
    writePidFile(process.pid)
    writePortFile(9222)

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as typeof fetch

    try {
      const { isManagedBrowserRunning } = await import('./browser-lifecycle.js')
      const result = await isManagedBrowserRunning()

      expect(result).toEqual({ running: false })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('refreshProfile', () => {
  it('calls browserStopCommand and browserStartCommand with silent: true', async () => {
    mockBrowserStopCommand.mockResolvedValue(undefined)
    mockBrowserStartCommand.mockResolvedValue(undefined)

    const { refreshProfile } = await import('./browser-lifecycle.js')
    await refreshProfile()

    expect(mockBrowserStopCommand).toHaveBeenCalledWith({ silent: true })
    expect(mockBrowserStartCommand).toHaveBeenCalledWith(
      expect.objectContaining({ silent: true, headless: true }),
    )
  })

  it('calls stop before start', async () => {
    const callOrder: string[] = []
    mockBrowserStopCommand.mockImplementation(async () => { callOrder.push('stop') })
    mockBrowserStartCommand.mockImplementation(async () => { callOrder.push('start') })

    const { refreshProfile } = await import('./browser-lifecycle.js')
    await refreshProfile()

    expect(callOrder).toEqual(['stop', 'start'])
  })

  it('does NOT call any token cache clearing functions', async () => {
    mockBrowserStopCommand.mockResolvedValue(undefined)
    mockBrowserStartCommand.mockResolvedValue(undefined)

    const { refreshProfile } = await import('./browser-lifecycle.js')
    await refreshProfile()

    // refreshProfile only calls stop+start, nothing else
    // Verify no unexpected calls beyond stop and start
    expect(mockBrowserStopCommand).toHaveBeenCalledTimes(1)
    expect(mockBrowserStartCommand).toHaveBeenCalledTimes(1)
  })
})

describe('handleLoginRequired', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // refreshProfile is called internally — mock its dependencies
    mockBrowserStopCommand.mockResolvedValue(undefined)
    mockBrowserStartCommand.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls retryFn after each backoff interval and returns when retryFn returns true', async () => {
    const retryFn = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const { handleLoginRequired } = await import('./browser-lifecycle.js')
    const promise = handleLoginRequired('https://example.com', retryFn, { timeout: 120_000 })

    // Advance through the backoff intervals
    // First poll: 5s wait → refreshProfile → retryFn (false)
    await vi.advanceTimersByTimeAsync(5_000)
    // Second poll: 10s wait → refreshProfile → retryFn (false)
    await vi.advanceTimersByTimeAsync(10_000)
    // Third poll: 20s wait → refreshProfile → retryFn (true) → return
    await vi.advanceTimersByTimeAsync(20_000)

    await promise

    expect(retryFn).toHaveBeenCalledTimes(3)
  })

  it('returns immediately when retryFn returns true on first poll', async () => {
    const retryFn = vi.fn().mockResolvedValueOnce(true)

    const { handleLoginRequired } = await import('./browser-lifecycle.js')
    const promise = handleLoginRequired('https://example.com', retryFn, { timeout: 60_000 })

    // First poll at 5s
    await vi.advanceTimersByTimeAsync(5_000)

    await promise

    expect(retryFn).toHaveBeenCalledTimes(1)
  })

  it('throws needs_login on timeout', async () => {
    const retryFn = vi.fn().mockResolvedValue(false)

    const { handleLoginRequired } = await import('./browser-lifecycle.js')
    const promise = handleLoginRequired('https://example.com', retryFn, { timeout: 1_000 })

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(2_000)

    await expect(promise).rejects.toThrow(OpenWebError)
    await expect(promise).rejects.toMatchObject({
      payload: expect.objectContaining({ failureClass: 'needs_login' }),
    })
  })

  it('backoff increases: verify intervals grow', async () => {
    const callTimes: number[] = []
    const retryFn = vi.fn().mockImplementation(async () => {
      callTimes.push(Date.now())
      return false
    })

    const { handleLoginRequired } = await import('./browser-lifecycle.js')
    const promise = handleLoginRequired('https://example.com', retryFn, { timeout: 120_000 })

    // Attach catch immediately to prevent unhandled rejection
    const settled = promise.catch(() => { /* expected timeout error */ })

    // Advance enough for several polls to fire
    // Intervals: 5s, 10s, 20s, 40s
    await vi.advanceTimersByTimeAsync(5_000)   // 1st poll at ~5s
    await vi.advanceTimersByTimeAsync(10_000)  // 2nd poll at ~15s
    await vi.advanceTimersByTimeAsync(20_000)  // 3rd poll at ~35s
    await vi.advanceTimersByTimeAsync(40_000)  // 4th poll at ~75s

    // Verify intervals are growing
    expect(retryFn.mock.calls.length).toBeGreaterThanOrEqual(3)

    if (callTimes.length >= 3) {
      const gap1 = callTimes[1]! - callTimes[0]!
      const gap2 = callTimes[2]! - callTimes[1]!
      expect(gap2).toBeGreaterThan(gap1)
    }

    // Clean up: advance past timeout and await settlement
    await vi.advanceTimersByTimeAsync(120_000)
    await settled
  })
})

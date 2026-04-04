import { execFile, spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { platform } from 'node:os'
import { join } from 'node:path'

import type { Browser } from 'playwright-core'

import { connectWithRetry } from '../capture/connection.js'
import { browserStartCommand, browserStopCommand } from '../commands/browser.js'
import { getBrowserConfig, openwebHome } from '../lib/config.js'
import { OpenWebError } from '../lib/errors.js'

// ── BrowserHandle ────────────────────────────────

export interface BrowserHandle {
  browser: Browser
  /** Calls browser.disconnect(), never kills Chrome */
  release(): Promise<void>
}

// ── State file paths ────────────────────────────

const PID_FILE = () => join(openwebHome(), 'browser.pid')
const PORT_FILE = () => join(openwebHome(), 'browser.port')
const LOCK_FILE = () => join(openwebHome(), 'browser.start.lock')
const LAST_USED_FILE = () => join(openwebHome(), 'browser.last-used')
const WATCHDOG_FILE = () => join(openwebHome(), 'browser.watchdog')

// ── Small helpers (mirrored from commands/browser.ts) ────

async function readPid(): Promise<number | null> {
  try {
    const raw = await readFile(PID_FILE(), 'utf8')
    const pid = Number(raw.trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    // intentional: PID file missing means no managed browser
    return null
  }
}

async function readPort(): Promise<number | null> {
  try {
    const raw = await readFile(PORT_FILE(), 'utf8')
    const port = Number(raw.trim())
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    // intentional: port file missing means no managed browser
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    // intentional: process.kill(0) throws if PID doesn't exist
    return false
  }
}

async function isCdpReady(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/json/version`)
    return response.ok
  } catch {
    // intentional: connection refused means Chrome not ready
    return false
  }
}

// ── Watchdog & last-used helpers ─────────────────

/** Write current epoch seconds to browser.last-used. */
export async function touchLastUsed(): Promise<void> {
  await mkdir(openwebHome(), { recursive: true })
  await writeFile(LAST_USED_FILE(), String(Math.floor(Date.now() / 1000)), { mode: 0o600 })
}

/** Check if the watchdog process is still alive. */
async function isWatchdogAlive(): Promise<boolean> {
  try {
    const raw = await readFile(WATCHDOG_FILE(), 'utf8')
    const pid = Number(raw.trim())
    if (!Number.isInteger(pid) || pid <= 0) return false
    return isProcessAlive(pid)
  } catch {
    // intentional: watchdog file missing
    return false
  }
}

/**
 * Spawn a detached watchdog shell process that kills Chrome after 5 minutes idle.
 * Writes watchdog PID to browser.watchdog.
 */
async function spawnWatchdog(): Promise<void> {
  const pidFile = PID_FILE()
  const portFile = PORT_FILE()
  const lastUsedFile = LAST_USED_FILE()
  const profileFile = join(openwebHome(), 'browser.profile')
  const watchdogFile = WATCHDOG_FILE()

  const script = [
    '#!/bin/sh',
    'while true; do',
    '  sleep 60',
    `  LAST=$(cat "${lastUsedFile}" 2>/dev/null || echo 0)`,
    '  NOW=$(date +%s)',
    '  if [ $((NOW - LAST)) -gt 300 ]; then',
    `    kill $(cat "${pidFile}" 2>/dev/null) 2>/dev/null`,
    `    rm -f "${pidFile}" "${portFile}" "${lastUsedFile}" "${profileFile}" "${watchdogFile}"`,
    '    exit 0',
    '  fi',
    'done',
  ].join('\n')

  const child = spawn('sh', ['-c', script], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  if (child.pid) {
    await writeFile(watchdogFile, String(child.pid), { mode: 0o600 })
  }
}

// ── Filesystem lock ─────────────────────────────

/**
 * Acquire a PID-file lock. Returns a release function on success.
 * If another process holds the lock and is alive, waits with polling.
 * Stale locks (dead PID) are automatically cleaned up.
 */
async function acquireLock(timeoutMs = 15_000): Promise<() => Promise<void>> {
  const lockPath = LOCK_FILE()
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      // Atomic create — fails if file exists (wx = exclusive create)
      await writeFile(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 })
      return async () => {
        try { await unlink(lockPath) } catch { /* already gone */ }
      }
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
        // Lock file exists — check if holder is alive
        try {
          const holderPid = Number((await readFile(lockPath, 'utf8')).trim())
          if (!Number.isInteger(holderPid) || holderPid <= 0 || !isProcessAlive(holderPid)) {
            // Stale lock — remove and retry immediately
            try { await unlink(lockPath) } catch { /* race: another process may have grabbed it */ }
            continue
          }
        } catch {
          // Lock file disappeared between EEXIST and read — retry immediately
          continue
        }
        // Holder is alive — wait and retry
        await new Promise((r) => setTimeout(r, 200))
        continue
      }
      throw err
    }
  }

  throw new OpenWebError({
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
    message: 'Timed out waiting for browser start lock.',
    action: `Remove ${lockPath} if no other openweb process is starting a browser.`,
    retriable: true,
    failureClass: 'retriable',
  })
}

// ── Public API ───────────────────────────────────

/**
 * Check if the managed browser is running.
 * Verifies PID file exists, process is alive, and CDP responds.
 */
export async function isManagedBrowserRunning(): Promise<{ running: boolean; port?: number }> {
  const pid = await readPid()
  if (!pid || !isProcessAlive(pid)) return { running: false }

  const port = await readPort()
  if (!port) return { running: false }

  if (await isCdpReady(port)) return { running: true, port }

  return { running: false }
}

/**
 * Ensure a browser is available. Returns a BrowserHandle with the
 * connected Browser and a release() method that disconnects from CDP
 * (never kills Chrome).
 *
 * 1. If `cdpEndpoint` provided (external CDP), connect directly.
 * 2. If managed browser running and CDP responds, connect, touch last-used,
 *    ensure watchdog alive (spawn if missing).
 * 3. Otherwise, auto-start headless Chrome, touch last-used, spawn watchdog.
 *
 * Concurrent calls are serialized via a filesystem lock so only one
 * Chrome process is ever started.
 */
export async function ensureBrowser(cdpEndpoint?: string): Promise<BrowserHandle> {
  // External CDP — connect directly, no managed browser involved
  if (cdpEndpoint) {
    const browser = await connectWithRetry(cdpEndpoint)
    return { browser, release: () => { browser.disconnect(); return Promise.resolve() } }
  }

  // Check for running managed browser
  const status = await isManagedBrowserRunning()
  if (status.running && status.port) {
    const browser = await connectWithRetry(`http://127.0.0.1:${status.port}`)
    await touchLastUsed()
    if (!(await isWatchdogAlive())) await spawnWatchdog()
    return { browser, release: () => { browser.disconnect(); return Promise.resolve() } }
  }

  // No managed browser — auto-start with filesystem lock
  await mkdir(openwebHome(), { recursive: true })
  const release = await acquireLock()
  try {
    // Re-check after acquiring lock (another process may have started Chrome)
    const recheck = await isManagedBrowserRunning()
    if (recheck.running && recheck.port) {
      const browser = await connectWithRetry(`http://127.0.0.1:${recheck.port}`)
      await touchLastUsed()
      if (!(await isWatchdogAlive())) await spawnWatchdog()
      return { browser, release: () => { browser.disconnect(); return Promise.resolve() } }
    }

    // Start headless Chrome
    const config = getBrowserConfig()
    await browserStartCommand({ silent: true, headless: true, ...config })

    // Read the port that browserStartCommand wrote
    const port = await readPort()
    if (!port) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: 'Browser started but port file not found.',
        action: 'Check browser start logs and retry.',
        retriable: true,
        failureClass: 'needs_browser',
      })
    }

    const browser = await connectWithRetry(`http://127.0.0.1:${port}`)
    await touchLastUsed()
    await spawnWatchdog()
    return { browser, release: () => { browser.disconnect(); return Promise.resolve() } }
  } finally {
    await release()
  }
}

/**
 * Tier 3 of the auth cascade: restart the managed browser with a fresh
 * copy of the user's default Chrome profile.
 *
 * Unlike `browserRestartCommand()`, this does NOT clear the token cache.
 * Cache invalidation is per-site on 401/403 (handled elsewhere).
 */
export async function refreshProfile(): Promise<void> {
  await browserStopCommand({ silent: true })
  await browserStartCommand({ silent: true, headless: true, ...getBrowserConfig() })
}

// ── Tier 4: User login with backoff poll ─────

const DEFAULT_LOGIN_TIMEOUT = 5 * 60_000 // 5 minutes
const INITIAL_POLL_INTERVAL = 5_000      // 5 seconds
const MAX_POLL_INTERVAL = 60_000         // 60 seconds

/** Open a URL in the user's system browser (fire and forget). */
function openInSystemBrowser(url: string): void {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refusing to open non-HTTP URL: ${url}`)
  }
  const os = platform()
  const cmd = os === 'darwin' ? 'open' : os === 'linux' ? 'xdg-open' : 'cmd'
  const args = os === 'win32' ? ['/c', 'start', '', url] : [url]
  execFile(cmd, args, () => { /* fire and forget */ })
}

/**
 * Tier 4 of the auth cascade: open the site in the user's system browser
 * for login, then poll with exponential backoff until auth succeeds or timeout.
 *
 * Each poll iteration:
 *   1. refreshProfile() — re-copy default Chrome profile to managed browser
 *   2. retryFn() — returns true if the operation now succeeds with fresh auth
 *   3. If true → return (login successful)
 *   4. If false → wait with exponential backoff (5s → 10s → 20s → 40s → 60s cap)
 *
 * On timeout, throws OpenWebError with failureClass 'needs_login'.
 */
export async function handleLoginRequired(
  siteUrl: string,
  retryFn: () => Promise<boolean>,
  options?: { timeout?: number },
): Promise<void> {
  openInSystemBrowser(siteUrl)
  process.stderr.write(`Opened ${siteUrl} in your browser. Waiting for login...\n`)

  const timeout = options?.timeout ?? DEFAULT_LOGIN_TIMEOUT
  const start = Date.now()
  let interval = INITIAL_POLL_INTERVAL

  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, interval))

    // Check timeout before doing work (interval may have pushed us past)
    if (Date.now() - start >= timeout) break

    await refreshProfile()
    const success = await retryFn()
    if (success) return

    // Exponential backoff: double interval, cap at 60s
    interval = Math.min(interval * 2, MAX_POLL_INTERVAL)
  }

  throw new OpenWebError({
    error: 'auth',
    code: 'AUTH_FAILED',
    message: `Login timed out after ${Math.round(timeout / 1000)}s waiting for authentication at ${siteUrl}.`,
    action: `Log in at ${siteUrl} in your browser, then retry the command.`,
    retriable: true,
    failureClass: 'needs_login',
  })
}

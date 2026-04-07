import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, cp, copyFile, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_USER_AGENT, TIMEOUT, getBrowserConfig, openwebHome } from '../lib/config.js'
import { OpenWebError } from '../lib/errors.js'

const PID_FILE = () => join(openwebHome(), 'browser.pid')
const PORT_FILE = () => join(openwebHome(), 'browser.port')
const PROFILE_DIR_FILE = () => join(openwebHome(), 'browser.profile')

function getDefaultProfilePath(): string {
  const os = platform()
  if (os === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default')
  }
  if (os === 'linux') {
    return join(homedir(), '.config', 'google-chrome', 'Default')
  }
  if (os === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data', 'Default')
  }
  throw new OpenWebError({
    error: 'execution_failed', code: 'EXECUTION_FAILED',
    message: `Unsupported platform: ${os}`,
    action: 'Chrome profile path detection is only supported on macOS, Linux, and Windows.',
    retriable: false, failureClass: 'fatal',
  })
}

function getChromePath(): string {
  const os = platform()
  if (os === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  }
  if (os === 'linux') {
    return 'google-chrome'
  }
  if (os === 'win32') {
    return 'chrome.exe'
  }
  throw new OpenWebError({
    error: 'execution_failed', code: 'EXECUTION_FAILED',
    message: `Unsupported platform: ${os}`,
    action: 'Chrome binary detection is only supported on macOS, Linux, and Windows.',
    retriable: false, failureClass: 'fatal',
  })
}

/** Copy only auth-relevant files from Chrome profile (not cache/history) */
export async function copyProfileSelective(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true, mode: 0o700 })

  // Only copy files needed for auth: Cookies, Local Storage (leveldb only), Session Storage, IndexedDB, Web Data
  const relevantDirs = ['Session Storage', 'IndexedDB']
  const relevantFiles = ['Cookies', 'Cookies-journal', 'Web Data', 'Web Data-journal', 'Preferences', 'Secure Preferences']

  for (const file of relevantFiles) {
    const srcPath = join(src, file)
    if (existsSync(srcPath)) {
      const destPath = join(dest, file)
      await copyFile(srcPath, destPath)
      await chmod(destPath, 0o600)
    }
  }

  for (const dir of relevantDirs) {
    const srcDir = join(src, dir)
    if (!existsSync(srcDir)) continue

    const destDir = join(dest, dir)
    await cp(srcDir, destDir, { recursive: true })
  }

  // Local Storage: copy only leveldb/ (skip 16k legacy .localstorage files from pre-2017 Chrome)
  const lsLevelDb = join(src, 'Local Storage', 'leveldb')
  if (existsSync(lsLevelDb)) {
    const destLs = join(dest, 'Local Storage', 'leveldb')
    await mkdir(destLs, { recursive: true })
    await cp(lsLevelDb, destLs, { recursive: true })
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
    // intentional: connection refused means Chrome not yet ready
    return false
  }
}

async function waitForCdp(port: number, timeoutMs = TIMEOUT.cdpReady): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isCdpReady(port)) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new OpenWebError({
    error: 'execution_failed', code: 'EXECUTION_FAILED',
    message: `CDP endpoint not ready after ${timeoutMs}ms`,
    action: 'Ensure Chrome started correctly and the CDP port is accessible.',
    retriable: true, failureClass: 'retriable',
  })
}

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

/** Kill a PID and its entire process tree (children, grandchildren). */
function killProcessTree(pid: number): void {
  // Kill process group first (covers children spawned with same PGID)
  try { process.kill(-pid, 'SIGTERM') } catch { /* not a group leader or already dead */ }
  // Also kill the process directly in case group kill missed it
  try { process.kill(pid, 'SIGTERM') } catch { /* already dead */ }
}

/** Discover the PID that owns a listening TCP port via lsof. */
function discoverPidFromPort(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('lsof', ['-ti', `TCP:${port}`, '-sTCP:LISTEN'], (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const pids = stdout.trim().split('\n').map(Number).filter((n) => n > 0)
      resolve(pids[0] ?? null)
    })
  })
}

/** Attempt to stop the managed Chrome. Returns true if stopped or already dead, false if unverified. */
async function killManaged(): Promise<boolean> {
  const pid = await readPid()
  const port = await readPort()

  const cleanup = async () => {
    try { await unlink(PID_FILE()) } catch { /* already gone */ }
    try { await unlink(PORT_FILE()) } catch { /* already gone */ }
    try {
      const wdPid = Number((await readFile(join(openwebHome(), 'browser.watchdog'), 'utf8')).trim())
      if (wdPid > 0) process.kill(wdPid, 'SIGTERM')
    } catch { /* no watchdog */ }
    try { await unlink(join(openwebHome(), 'browser.watchdog')) } catch { /* already gone */ }
    try { await unlink(join(openwebHome(), 'browser.last-used')) } catch { /* already gone */ }
  }

  // If stored PID is dead, check if Chrome is still on the port (macOS re-exec case)
  if (!pid || !isProcessAlive(pid)) {
    if (port && await isCdpReady(port)) {
      const actualPid = await discoverPidFromPort(port)
      if (actualPid) {
        killProcessTree(actualPid)
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    await cleanup()
    return true
  }

  // Verify this PID is actually our managed Chrome by checking CDP on the stored port
  if (port && await isCdpReady(port)) {
    killProcessTree(pid)
    // Also kill whatever is actually on the port (in case PID diverged)
    const actualPid = await discoverPidFromPort(port)
    if (actualPid && actualPid !== pid) killProcessTree(actualPid)
    await new Promise((r) => setTimeout(r, 500))
    await cleanup()
    return true
  }

  // PID alive but CDP unreachable — kill it anyway (it's our managed process)
  killProcessTree(pid)
  await new Promise((r) => setTimeout(r, 500))
  await cleanup()
  return true
}

async function cleanTempProfile(): Promise<void> {
  try {
    const profileDir = (await readFile(PROFILE_DIR_FILE(), 'utf8')).trim()
    // Safety: only rm -rf paths that look like our mkdtemp output
    const expectedPrefix = join(tmpdir(), 'openweb-profile-')
    if (profileDir?.startsWith(expectedPrefix)) {
      await rm(profileDir, { recursive: true, force: true })
    }
    await unlink(PROFILE_DIR_FILE())
  } catch { /* already gone */ }
}

export async function browserStartCommand(options: { headless?: boolean; port?: number; profile?: string; silent?: boolean } = {}): Promise<void> {
  const log = options.silent ? (_msg: string) => {} : (msg: string) => process.stdout.write(msg)
  const browserConfig = getBrowserConfig()
  const port = options.port ?? browserConfig.port
  const headless = options.headless ?? browserConfig.headless

  // Check if already running
  const existingPid = await readPid()
  if (existingPid && isProcessAlive(existingPid)) {
    const existingPort = await readPort() ?? port
    if (await isCdpReady(existingPort)) {
      log(`Chrome already running (PID ${existingPid}) at http://localhost:${existingPort}\n`)
      return
    }
  }

  // Get and copy profile
  const profilePath = options.profile ?? browserConfig.profile ?? getDefaultProfilePath()
  if (!existsSync(profilePath)) {
    throw new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: `Chrome profile not found at ${profilePath}. Is Chrome installed?`,
      action: 'Install Chrome or verify the profile directory exists.',
      retriable: false, failureClass: 'fatal',
    })
  }

  // Use mkdtemp for an unpredictable temp directory
  const tempUserDataDir = await mkdtemp(join(tmpdir(), 'openweb-profile-'))
  await chmod(tempUserDataDir, 0o700)
  const tempProfileDir = join(tempUserDataDir, 'Default')
  await copyProfileSelective(profilePath, tempProfileDir)

  // Launch Chrome
  const chromePath = getChromePath()
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tempUserDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
  ]
  // Only override UA when user explicitly sets userAgent in config.json
  // Default: let Chrome use its native UA (stealthier, no --user-agent flag detectable)
  try {
    const raw = JSON.parse(readFileSync(join(openwebHome(), 'config.json'), 'utf8'))
    if (typeof raw?.userAgent === 'string') args.push(`--user-agent=${raw.userAgent}`)
  } catch { /* no config or parse error — use native UA */ }
  if (headless) {
    args.push('--headless=new')
  }

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  if (!child.pid) {
    throw new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: 'Failed to start Chrome',
      action: 'Check that Chrome is installed and the binary path is correct.',
      retriable: true, failureClass: 'retriable',
    })
  }

  // Save PID, port, and temp profile path
  await mkdir(openwebHome(), { recursive: true })
  await writeFile(PID_FILE(), String(child.pid), { mode: 0o600 })
  await writeFile(PORT_FILE(), String(port), { mode: 0o600 })
  await writeFile(PROFILE_DIR_FILE(), tempUserDataDir, { mode: 0o600 })

  // Wait for CDP
  await waitForCdp(port)

  // macOS: headed Chrome may re-exec, causing the original PID to die.
  // Discover the real PID from the port and update the PID file.
  if (!isProcessAlive(child.pid!)) {
    const actualPid = await discoverPidFromPort(port)
    if (actualPid) {
      await writeFile(PID_FILE(), String(actualPid), { mode: 0o600 })
      log(`Chrome started (PID ${actualPid}) at http://localhost:${port}\n`)
      return
    }
  }

  log(`Chrome started (PID ${child.pid}) at http://localhost:${port}\n`)
}

export async function browserStopCommand(options: { silent?: boolean } = {}): Promise<void> {
  const log = options.silent ? (_msg: string) => {} : (msg: string) => process.stdout.write(msg)
  const pid = await readPid()
  if (!pid || !isProcessAlive(pid)) {
    log('No managed Chrome process running.\n')
    try { await unlink(PID_FILE()) } catch { /* already gone */ }
    try { await unlink(PORT_FILE()) } catch { /* already gone */ }
    await cleanTempProfile()
    return
  }

  const stopped = await killManaged()
  if (stopped) {
    await cleanTempProfile()
    log('Chrome stopped.\n')
  }
  // If not stopped, killManaged already printed the warning
}

/** Get open tab URLs from managed Chrome via CDP /json/list. Exported for testing. */
export async function getOpenTabUrls(port: number): Promise<string[]> {
  try {
    const response = await fetch(`http://localhost:${port}/json/list`)
    if (!response.ok) return []
    const tabs = await response.json() as Array<{ type: string; url: string }>
    return tabs
      .filter((t) => t.type === 'page' && t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('about:'))
      .map((t) => t.url)
  } catch {
    // intentional: CDP unavailable — no tabs to save
    return []
  }
}

/** Restore tabs by creating new tabs via CDP. Exported for testing. */
export async function restoreTabs(port: number, urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      await fetch(`http://localhost:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
    } catch {
      // intentional: best-effort tab restoration
    }
  }
}

export async function browserRestartCommand(options: { headless?: boolean; port?: number; profile?: string; silent?: boolean } = {}): Promise<void> {
  const port = options.port ?? (await readPort()) ?? getBrowserConfig().port

  // Save open tab URLs before killing
  const tabUrls = await getOpenTabUrls(port)

  const stopped = await killManaged()
  if (!stopped) {
    throw new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: 'Cannot restart: previous Chrome process could not be verified and stopped. Resolve manually first.',
      action: 'Kill the existing Chrome process manually, then retry.',
      retriable: false, failureClass: 'fatal',
    })
  }
  await cleanTempProfile()

  await browserStartCommand(options)

  // Restore previously open tabs
  if (tabUrls.length > 0) {
    const activePort = options.port ?? (await readPort()) ?? getBrowserConfig().port
    await restoreTabs(activePort, tabUrls)
    if (!options.silent) {
      process.stdout.write(`Restored ${tabUrls.length} tab(s).\n`)
    }
  }
}

export async function browserStatusCommand(): Promise<void> {
  const pid = await readPid()
  const port = await readPort() ?? getBrowserConfig().port

  if (!pid) {
    process.stdout.write('No managed Chrome. Run: openweb browser start\n')
    return
  }

  const alive = isProcessAlive(pid)
  const cdpReady = alive ? await isCdpReady(port) : false

  if (alive && cdpReady) {
    process.stdout.write(`Chrome running (PID ${pid}) at http://localhost:${port}\n`)
  } else if (alive) {
    process.stdout.write(`Chrome running (PID ${pid}) but CDP not responding on port ${port}\n`)
  } else {
    process.stdout.write(`Chrome not running (stale PID ${pid}). Run: openweb browser start\n`)
    // Clean up stale PID file
    try { await unlink(PID_FILE()) } catch { /* ok */ }
    try { await unlink(PORT_FILE()) } catch { /* ok */ }
  }
}

export async function loginCommand(site: string): Promise<void> {
  // Load manifest to get site_url
  const { resolveSiteRoot } = await import('../lib/openapi.js')
  const { loadManifest } = await import('../lib/manifest.js')

  const siteRoot = await resolveSiteRoot(site)
  const manifest = await loadManifest(siteRoot)
  const url = manifest?.site_url

  if (!url) {
    throw new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: `No site_url in manifest for ${site}. Cannot determine login URL.`,
      action: 'Add a site_url field to the site manifest.',
      retriable: false, failureClass: 'fatal',
    })
  }

  // Validate URL scheme — only allow http/https to prevent command injection
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: `Invalid URL in manifest for ${site}: ${url}`,
      action: 'Fix the site_url in the site manifest.',
      retriable: false, failureClass: 'fatal',
    })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: `Refusing to open non-HTTP URL: ${url}`,
      action: 'Only http:// and https:// URLs are allowed.',
      retriable: false, failureClass: 'fatal',
    })
  }

  // Prefer opening in managed Chrome; fall back to system browser
  const port = await readPort()
  if (port && await isCdpReady(port)) {
    try {
      await fetch(`http://localhost:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
      process.stdout.write(`Opened ${url} in managed browser.\nLogin there, then run: openweb browser restart\n`)
      return
    } catch {
      // intentional: CDP tab creation failed — fall through to system browser
    }
  }

  // Fall back to system default browser
  const os = platform()
  await new Promise<void>((resolve, reject) => {
    const cmd = os === 'darwin' ? 'open' : os === 'linux' ? 'xdg-open' : 'cmd'
    const args = os === 'win32' ? ['/c', 'start', '', url] : [url]
    execFile(cmd, args, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })

  process.stdout.write(`Opened ${url} in your browser.\nLogin, then run: openweb browser restart\n`)
}

/** Read managed browser port, or return undefined if not available */
export async function getManagedCdpEndpoint(): Promise<string | undefined> {
  const port = await readPort()
  if (!port) return undefined
  if (await isCdpReady(port)) return `http://127.0.0.1:${port}`
  return undefined
}

/** Resolve CDP endpoint: managed browser → --cdp-endpoint flag → error */
export async function resolveCdpEndpoint(flagValue?: string): Promise<string> {
  // 1. Try managed browser
  const managed = await getManagedCdpEndpoint()
  if (managed) return managed

  // 2. Use explicit flag
  if (flagValue) return flagValue

  throw OpenWebError.needsBrowser()
}

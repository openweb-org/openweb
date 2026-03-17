import { spawn, execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink, copyFile, readdir, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform, tmpdir } from 'node:os'

const OPENWEB_DIR = join(homedir(), '.openweb')
const PID_FILE = join(OPENWEB_DIR, 'browser.pid')
const PORT_FILE = join(OPENWEB_DIR, 'browser.port')
const PROFILE_DIR_FILE = join(OPENWEB_DIR, 'browser.profile')
const DEFAULT_PORT = 9222

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
  throw new Error(`Unsupported platform: ${os}`)
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
  throw new Error(`Unsupported platform: ${os}`)
}

/** Copy only auth-relevant files from Chrome profile (not cache/history) */
async function copyProfileSelective(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true, mode: 0o700 })

  // Only copy files needed for auth: Cookies, Local Storage, Session Storage, Web Data
  const relevantDirs = ['Local Storage', 'Session Storage']
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
    await mkdir(destDir, { recursive: true, mode: 0o700 })

    const entries = await readdir(srcDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile()) {
        const destPath = join(destDir, entry.name)
        await copyFile(join(srcDir, entry.name), destPath)
        await chmod(destPath, 0o600)
      }
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function isCdpReady(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/json/version`)
    return response.ok
  } catch {
    return false
  }
}

async function waitForCdp(port: number, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isCdpReady(port)) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`CDP endpoint not ready after ${timeoutMs}ms`)
}

async function readPid(): Promise<number | null> {
  try {
    const raw = await readFile(PID_FILE, 'utf8')
    const pid = Number(raw.trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

async function readPort(): Promise<number | null> {
  try {
    const raw = await readFile(PORT_FILE, 'utf8')
    const port = Number(raw.trim())
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

async function killManaged(): Promise<void> {
  const pid = await readPid()
  const port = await readPort()

  if (pid && isProcessAlive(pid)) {
    // Verify this PID is actually our managed Chrome by checking CDP on the stored port
    let verified = false
    if (port) {
      verified = await isCdpReady(port)
    }

    if (verified) {
      process.kill(pid, 'SIGTERM')
      await new Promise((r) => setTimeout(r, 500))
    }
    // If not verified, PID may have been reused — don't kill, just clean up state files
  }

  try { await unlink(PID_FILE) } catch { /* already gone */ }
  try { await unlink(PORT_FILE) } catch { /* already gone */ }
}

async function cleanTempProfile(): Promise<void> {
  try {
    const profileDir = await readFile(PROFILE_DIR_FILE, 'utf8')
    if (profileDir.trim()) {
      await rm(profileDir.trim(), { recursive: true, force: true })
    }
    await unlink(PROFILE_DIR_FILE)
  } catch { /* already gone */ }
}

export async function browserStartCommand(options: { headless?: boolean; port?: number } = {}): Promise<void> {
  const port = options.port ?? DEFAULT_PORT

  // Check if already running
  const existingPid = await readPid()
  if (existingPid && isProcessAlive(existingPid)) {
    const existingPort = await readPort() ?? port
    if (await isCdpReady(existingPort)) {
      process.stdout.write(`Chrome already running (PID ${existingPid}) at http://localhost:${existingPort}\n`)
      return
    }
  }

  // Get and copy profile
  const profilePath = getDefaultProfilePath()
  if (!existsSync(profilePath)) {
    throw new Error(`Chrome profile not found at ${profilePath}. Is Chrome installed?`)
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
  ]
  if (options.headless) {
    args.push('--headless=new')
  }

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  if (!child.pid) {
    throw new Error('Failed to start Chrome')
  }

  // Save PID, port, and temp profile path
  await mkdir(OPENWEB_DIR, { recursive: true })
  await writeFile(PID_FILE, String(child.pid), { mode: 0o600 })
  await writeFile(PORT_FILE, String(port), { mode: 0o600 })
  await writeFile(PROFILE_DIR_FILE, tempUserDataDir, { mode: 0o600 })

  // Wait for CDP
  await waitForCdp(port)
  process.stdout.write(`Chrome started (PID ${child.pid}) at http://localhost:${port}\n`)
}

export async function browserStopCommand(): Promise<void> {
  const pid = await readPid()
  if (!pid || !isProcessAlive(pid)) {
    process.stdout.write('No managed Chrome process running.\n')
    try { await unlink(PID_FILE) } catch { /* already gone */ }
    try { await unlink(PORT_FILE) } catch { /* already gone */ }
    return
  }

  await killManaged()
  await cleanTempProfile()
  process.stdout.write('Chrome stopped.\n')
}

export async function browserRestartCommand(options: { headless?: boolean; port?: number } = {}): Promise<void> {
  await killManaged()
  await cleanTempProfile()

  // Clear token cache
  const tokensDir = join(OPENWEB_DIR, 'tokens')
  await rm(tokensDir, { recursive: true, force: true })

  await browserStartCommand(options)
}

export async function browserStatusCommand(): Promise<void> {
  const pid = await readPid()
  const port = await readPort() ?? DEFAULT_PORT

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
    try { await unlink(PID_FILE) } catch { /* ok */ }
    try { await unlink(PORT_FILE) } catch { /* ok */ }
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
    throw new Error(`No site_url in manifest for ${site}. Cannot determine login URL.`)
  }

  // Validate URL scheme — only allow http/https to prevent command injection
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid URL in manifest for ${site}: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refusing to open non-HTTP URL: ${url}`)
  }

  // Open in default browser using execFile with argv (no shell)
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
  if (await isCdpReady(port)) return `http://localhost:${port}`
  return undefined
}

/** Resolve CDP endpoint: managed browser → --cdp-endpoint flag → error */
export async function resolveCdpEndpoint(flagValue?: string): Promise<string> {
  // 1. Try managed browser
  const managed = await getManagedCdpEndpoint()
  if (managed) return managed

  // 2. Use explicit flag
  if (flagValue) return flagValue

  throw new Error('No browser available. Run `openweb browser start` or pass --cdp-endpoint.')
}

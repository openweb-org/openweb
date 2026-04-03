import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { openwebHome } from '../lib/config.js'
import { OpenWebError } from '../lib/errors.js'

const pbkdf2Async = promisify(pbkdf2)

const TOKENS_DIR = () => join(openwebHome(), 'tokens')
const DEFAULT_TTL_SECONDS = 3600 // 1 hour

const PBKDF2_ITERATIONS = 210_000
const PBKDF2_KEYLEN = 32
const PBKDF2_DIGEST = 'sha256'
const AES_ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const SALT_BYTES = 32
const VAULT_VERSION = 1

export interface CachedTokens {
  readonly cookies: Cookie[]
  readonly localStorage: Record<string, string>
  readonly sessionStorage: Record<string, string>
  readonly capturedAt: string
  readonly ttlSeconds: number
  readonly jwtExp?: number
}

export interface Cookie {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path: string
  readonly httpOnly?: boolean
  readonly secure?: boolean
  readonly sameSite?: string
  readonly expires?: number
}

interface VaultEnvelope {
  version: number
  alg: string
  kdf: string
  iterations: number
  iv: string
  tag: string
  ciphertext: string
}

// --- Expiry ---

function isExpired(tokens: CachedTokens): boolean {
  const capturedMs = new Date(tokens.capturedAt).getTime()
  if (!Number.isFinite(capturedMs)) return true

  if (tokens.jwtExp !== undefined) {
    if (!Number.isFinite(tokens.jwtExp)) return true
    return Date.now() > tokens.jwtExp * 1000
  }

  if (!Number.isFinite(tokens.ttlSeconds) || tokens.ttlSeconds <= 0) return true

  return Date.now() > capturedMs + tokens.ttlSeconds * 1000
}

/** Parse JWT payload to extract exp claim. Returns undefined if not a JWT. */
export function extractJwtExp(token: string): number | undefined {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return undefined
    const part = parts[1]
    if (!part) return undefined
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>
    const exp = payload.exp
    return typeof exp === 'number' ? exp : undefined
  } catch {
    // intentional: not a JWT — return undefined is the expected path
    return undefined
  }
}

// --- Salt ---

async function ensureSalt(tokenRoot: string): Promise<Buffer> {
  return withLock(`__salt__${tokenRoot}`, async () => {
    const saltPath = join(tokenRoot, '.salt')
    try {
      const s = await stat(saltPath)
      if (s.isFile()) {
        return await readFile(saltPath)
      }
    } catch {
      // intentional: salt file does not exist — will be created below
    }
    await mkdir(tokenRoot, { recursive: true, mode: 0o700 })
    const salt = randomBytes(SALT_BYTES)
    await writeFile(saltPath, salt, { mode: 0o600 })
    return salt
  })
}

// --- Key derivation with per-root cache ---

const keyCache = new Map<string, { saltHex: string; key: Buffer }>()

function machineFingerprint(): string {
  return `openweb-token-cache-v1\nhost=${hostname()}\nhome=${homedir()}\n`
}

async function deriveKey(tokenRoot: string): Promise<Buffer> {
  const salt = await ensureSalt(tokenRoot)
  const saltHex = salt.toString('hex')
  const cached = keyCache.get(tokenRoot)
  if (cached && cached.saltHex === saltHex) return cached.key

  const key = await pbkdf2Async(
    machineFingerprint(),
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEYLEN,
    PBKDF2_DIGEST,
  )
  keyCache.set(tokenRoot, { saltHex, key })
  return key
}

// --- AES-256-GCM encrypt / decrypt ---

function encrypt(tokens: CachedTokens, key: Buffer): VaultEnvelope {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(AES_ALGORITHM, key, iv)
  const plaintext = JSON.stringify(tokens)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    version: VAULT_VERSION,
    alg: AES_ALGORITHM,
    kdf: 'pbkdf2-sha256',
    iterations: PBKDF2_ITERATIONS,
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    ciphertext: encrypted.toString('base64url'),
  }
}

function decrypt(envelope: VaultEnvelope, key: Buffer): CachedTokens {
  const iv = Buffer.from(envelope.iv, 'base64url')
  const tag = Buffer.from(envelope.tag, 'base64url')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64url')
  const decipher = createDecipheriv(AES_ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(decrypted.toString('utf8')) as CachedTokens
}

// --- Per-site mutex ---

const locks = new Map<string, Promise<void>>()

async function withLock<T>(key: string, fn: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  let release: (() => void) | undefined
  const next = new Promise<void>(resolve => { release = resolve })
  locks.set(key, next)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      prev,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: `Lock acquisition timed out for ${key} after ${timeoutMs}ms`,
          action: 'Retry the operation — another request may be holding the lock.',
          retriable: true,
          failureClass: 'retriable',
        })), timeoutMs)
      }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    return await fn()
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    release?.()
    if (locks.get(key) === next) locks.delete(key)
  }
}

/**
 * Serialize a block of token cache operations for a site.
 * Use this in http-executor to wrap the full read→try→fallback→write sequence.
 */
export async function withTokenLock<T>(site: string, fn: () => Promise<T>): Promise<T> {
  return withLock(site, fn)
}

// --- Public API ---

function tokenRoot(baseDir?: string): string {
  return baseDir ?? TOKENS_DIR()
}

function siteDir(site: string, baseDir?: string): string {
  return join(tokenRoot(baseDir), site)
}

/** Internal read — caller must hold the lock */
async function readTokenCacheUnsafe(site: string, baseDir?: string): Promise<CachedTokens | null> {
  const root = tokenRoot(baseDir)
  const dir = siteDir(site, baseDir)
  const vaultPath = join(dir, 'vault.json')

  try {
    const raw = await readFile(vaultPath, 'utf8')
    const envelope = JSON.parse(raw) as VaultEnvelope
    const key = await deriveKey(root)
    const tokens = decrypt(envelope, key)
    if (isExpired(tokens)) {
      await clearTokenCacheUnsafe(site, baseDir)
      return null
    }
    return tokens
  } catch (err: unknown) {
    // vault.json missing → EMPTY state, return null silently
    if (isFileNotFoundError(err)) return null
    // decrypt failure / corrupt / malformed → clear and return null
    await clearTokenCacheUnsafe(site, baseDir).catch(() => {}) // intentional: best-effort cleanup of corrupt vault
    return null
  }
}

export async function readTokenCache(site: string, baseDir?: string): Promise<CachedTokens | null> {
  return withLock(site, () => readTokenCacheUnsafe(site, baseDir))
}

function isFileNotFoundError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

/** Internal write — caller must hold the lock */
async function writeTokenCacheUnsafe(site: string, tokens: CachedTokens, baseDir?: string): Promise<void> {
  const root = tokenRoot(baseDir)
  const dir = siteDir(site, baseDir)
  await mkdir(dir, { recursive: true, mode: 0o700 })

  const key = await deriveKey(root)
  const envelope = encrypt(tokens, key)

  const tmpPath = join(dir, 'vault.json.tmp')
  const vaultPath = join(dir, 'vault.json')
  await writeFile(tmpPath, JSON.stringify(envelope, null, 2), { mode: 0o600 })
  await rename(tmpPath, vaultPath)
}

export async function writeTokenCache(site: string, tokens: CachedTokens, baseDir?: string): Promise<void> {
  return withLock(site, () => writeTokenCacheUnsafe(site, tokens, baseDir))
}

/** Internal clear — caller must hold the lock */
async function clearTokenCacheUnsafe(site: string, baseDir?: string): Promise<void> {
  await rm(siteDir(site, baseDir), { recursive: true, force: true })
}

export async function clearTokenCache(site: string, baseDir?: string): Promise<void> {
  return withLock(site, () => clearTokenCacheUnsafe(site, baseDir))
}

export async function clearAllTokenCache(baseDir?: string): Promise<void> {
  const root = tokenRoot(baseDir)
  keyCache.delete(root)
  await rm(root, { recursive: true, force: true })
}

export { DEFAULT_TTL_SECONDS }

/** Lock-free variants for use inside withTokenLock — caller must already hold the lock */
export { readTokenCacheUnsafe, clearTokenCacheUnsafe, writeTokenCacheUnsafe }

/** Exposed for testing — number of active site locks */
export function _activeLockCount(): number {
  return locks.size
}

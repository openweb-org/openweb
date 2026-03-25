import { mkdir, readFile, writeFile, rm, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, hostname } from 'node:os'
import { randomBytes, pbkdf2, createCipheriv, createDecipheriv } from 'node:crypto'
import { promisify } from 'node:util'

const pbkdf2Async = promisify(pbkdf2)

const TOKENS_DIR = join(homedir(), '.openweb', 'tokens')
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
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as Record<string, unknown>
    const exp = payload.exp
    return typeof exp === 'number' ? exp : undefined
  } catch {
    return undefined
  }
}

// --- Salt ---

async function ensureSalt(tokenRoot: string): Promise<Buffer> {
  const saltPath = join(tokenRoot, '.salt')
  try {
    const s = await stat(saltPath)
    if (s.isFile()) {
      return await readFile(saltPath)
    }
  } catch {
    // does not exist, create below
  }
  await mkdir(tokenRoot, { recursive: true, mode: 0o700 })
  const salt = randomBytes(SALT_BYTES)
  await writeFile(saltPath, salt, { mode: 0o600 })
  return salt
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

// --- Public API ---

function tokenRoot(baseDir?: string): string {
  return baseDir ?? TOKENS_DIR
}

function siteDir(site: string, baseDir?: string): string {
  return join(tokenRoot(baseDir), site)
}

export async function readTokenCache(site: string, baseDir?: string): Promise<CachedTokens | null> {
  const root = tokenRoot(baseDir)
  const dir = siteDir(site, baseDir)
  const vaultPath = join(dir, 'vault.json')

  try {
    const raw = await readFile(vaultPath, 'utf8')
    const envelope = JSON.parse(raw) as VaultEnvelope
    const key = await deriveKey(root)
    const tokens = decrypt(envelope, key)
    if (isExpired(tokens)) {
      await clearTokenCache(site, baseDir)
      return null
    }
    return tokens
  } catch (err: unknown) {
    // vault.json missing → EMPTY state, return null silently
    if (isFileNotFoundError(err)) return null
    // decrypt failure / corrupt / malformed → clear and return null
    await clearTokenCache(site, baseDir).catch(() => {})
    return null
  }
}

function isFileNotFoundError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

export async function writeTokenCache(site: string, tokens: CachedTokens, baseDir?: string): Promise<void> {
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

export async function clearTokenCache(site: string, baseDir?: string): Promise<void> {
  await rm(siteDir(site, baseDir), { recursive: true, force: true })
}

export async function clearAllTokenCache(baseDir?: string): Promise<void> {
  const root = tokenRoot(baseDir)
  keyCache.delete(root)
  await rm(root, { recursive: true, force: true })
}

export { DEFAULT_TTL_SECONDS }

import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const TOKENS_DIR = join(homedir(), '.openweb', 'tokens')
const DEFAULT_TTL_SECONDS = 3600 // 1 hour

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

interface CacheMeta {
  readonly captured_at: string
  readonly ttl_seconds: number
  readonly jwt_exp?: number
}

function isExpired(meta: CacheMeta): boolean {
  const capturedMs = new Date(meta.captured_at).getTime()
  if (Number.isNaN(capturedMs)) return true

  // If JWT exp is present, use it as the primary expiry
  if (meta.jwt_exp) {
    return Date.now() > meta.jwt_exp * 1000
  }

  return Date.now() > capturedMs + meta.ttl_seconds * 1000
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

function siteDir(site: string, baseDir?: string): string {
  return join(baseDir ?? TOKENS_DIR, site)
}

export async function readTokenCache(site: string, baseDir?: string): Promise<CachedTokens | null> {
  const dir = siteDir(site, baseDir)
  try {
    const metaRaw = await readFile(join(dir, 'meta.json'), 'utf8')
    const meta = JSON.parse(metaRaw) as CacheMeta

    if (isExpired(meta)) return null

    const cookiesRaw = await readFile(join(dir, 'cookies.json'), 'utf8')
    const storageRaw = await readFile(join(dir, 'storage.json'), 'utf8')

    const cookies = JSON.parse(cookiesRaw) as Cookie[]
    const storage = JSON.parse(storageRaw) as { localStorage: Record<string, string>; sessionStorage: Record<string, string> }

    return {
      cookies,
      localStorage: storage.localStorage,
      sessionStorage: storage.sessionStorage,
      capturedAt: meta.captured_at,
      ttlSeconds: meta.ttl_seconds,
      jwtExp: meta.jwt_exp,
    }
  } catch {
    return null
  }
}

export async function writeTokenCache(site: string, tokens: CachedTokens, baseDir?: string): Promise<void> {
  const dir = siteDir(site, baseDir)
  await mkdir(dir, { recursive: true, mode: 0o700 })

  const meta: CacheMeta = {
    captured_at: tokens.capturedAt,
    ttl_seconds: tokens.ttlSeconds,
    jwt_exp: tokens.jwtExp,
  }

  const storage = {
    localStorage: tokens.localStorage,
    sessionStorage: tokens.sessionStorage,
  }

  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), { mode: 0o600 })
  await writeFile(join(dir, 'cookies.json'), JSON.stringify(tokens.cookies, null, 2), { mode: 0o600 })
  await writeFile(join(dir, 'storage.json'), JSON.stringify(storage, null, 2), { mode: 0o600 })
}

export async function clearTokenCache(site: string, baseDir?: string): Promise<void> {
  await rm(siteDir(site, baseDir), { recursive: true, force: true })
}

export async function clearAllTokenCache(baseDir?: string): Promise<void> {
  await rm(baseDir ?? TOKENS_DIR, { recursive: true, force: true })
}

export { DEFAULT_TTL_SECONDS }

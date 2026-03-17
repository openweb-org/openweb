import { OpenWebError } from '../../lib/errors.js'
import type { BrowserHandle } from './types.js'

interface StorageSnapshot {
  readonly sessionStorage: Readonly<Record<string, string>>
  readonly localStorage: Readonly<Record<string, string>>
}

interface MsalTokenEntry {
  readonly credentialType?: string
  readonly target?: string
  readonly scopes?: readonly string[]
  readonly expiresOn?: string
  readonly [key: string]: unknown
}

export interface SessionStorageMsalConfig {
  readonly key_pattern: string
  readonly scope_filter?: string
  readonly token_field: string
  readonly inject: {
    readonly header?: string
    readonly prefix?: string
    readonly query?: string
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) {
    return undefined
  }

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function readAccessTokenKeys(index: unknown): string[] {
  if (Array.isArray(index)) {
    return index.filter((value): value is string => typeof value === 'string')
  }

  if (!index || typeof index !== 'object') {
    return []
  }

  const value = (index as { accessToken?: unknown }).accessToken
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function normalizeScopes(entry: MsalTokenEntry): string[] {
  if (Array.isArray(entry.scopes)) {
    return entry.scopes
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase())
  }

  if (typeof entry.target === 'string') {
    return entry.target.split(/\s+/).filter(Boolean).map((value) => value.toLowerCase())
  }

  return []
}

function expiresAt(entry: MsalTokenEntry): number {
  const parsed = Number(entry.expiresOn)
  return Number.isFinite(parsed) ? parsed : 0
}

function collectAccessTokens(storage: Readonly<Record<string, string>>, pattern: RegExp): MsalTokenEntry[] {
  const entries: MsalTokenEntry[] = []
  for (const [key, rawValue] of Object.entries(storage)) {
    if (!pattern.test(key)) {
      continue
    }

    const parsed = parseJson(rawValue)
    for (const tokenKey of readAccessTokenKeys(parsed)) {
      const tokenEntry = parseJson(storage[tokenKey])
      if (tokenEntry && typeof tokenEntry === 'object') {
        entries.push(tokenEntry as MsalTokenEntry)
      }
    }

    if (parsed && typeof parsed === 'object' && (parsed as MsalTokenEntry).credentialType === 'AccessToken') {
      entries.push(parsed as MsalTokenEntry)
    }
  }

  return entries
}

function findMatchingToken(snapshot: StorageSnapshot, config: SessionStorageMsalConfig): string | undefined {
  const pattern = globToRegExp(config.key_pattern)
  const storages = [snapshot.sessionStorage, snapshot.localStorage]
  const now = Math.floor(Date.now() / 1000)
  const requestedScope = config.scope_filter?.toLowerCase()

  for (const storage of storages) {
    const candidates = collectAccessTokens(storage, pattern)
      .filter((entry) => entry.credentialType === 'AccessToken')
      .filter((entry) => {
        if (!requestedScope) {
          return true
        }
        return normalizeScopes(entry).some((scope) => scope.includes(requestedScope))
      })
      .filter((entry) => expiresAt(entry) === 0 || expiresAt(entry) > now)
      .sort((left, right) => expiresAt(right) - expiresAt(left))

    for (const candidate of candidates) {
      const value = candidate[config.token_field]
      if (typeof value === 'string' && value.length > 0) {
        return value
      }
    }
  }

  return undefined
}

export async function resolveSessionStorageMsal(
  handle: BrowserHandle,
  config: SessionStorageMsalConfig,
): Promise<{ readonly headers: Readonly<Record<string, string>>; readonly queryParams?: Readonly<Record<string, string>> }> {
  let snapshot: StorageSnapshot
  try {
    snapshot = await handle.page.evaluate(() => {
      const sessionStorageValues: Record<string, string> = {}
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index)
        if (!key) {
          continue
        }

        const value = window.sessionStorage.getItem(key)
        if (value !== null) {
          sessionStorageValues[key] = value
        }
      }

      const localStorageValues: Record<string, string> = {}
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index)
        if (!key) {
          continue
        }

        const value = window.localStorage.getItem(key)
        if (value !== null) {
          localStorageValues[key] = value
        }
      }

      return {
        sessionStorage: sessionStorageValues,
        localStorage: localStorageValues,
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Failed to read MSAL storage: ${message}`,
      action: 'Ensure the Microsoft page is open and fully loaded, then retry.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  const token = findMatchingToken(snapshot, config)
  if (!token) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `No MSAL access token matched ${config.scope_filter ?? config.key_pattern}.`,
      action: 'Open the Microsoft app page and ensure you are logged in.',
      retriable: true,
      failureClass: 'needs_login',
    })
  }

  const headers: Record<string, string> = {}
  const queryParams: Record<string, string> = {}
  if (config.inject.header) {
    headers[config.inject.header] = `${config.inject.prefix ?? ''}${token}`
  }
  if (config.inject.query) {
    queryParams[config.inject.query] = token
  }

  return {
    headers,
    ...(Object.keys(queryParams).length > 0 ? { queryParams } : {}),
  }
}

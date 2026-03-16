export interface CachedAuth {
  readonly headers: Readonly<Record<string, string>>
  readonly cookieString?: string
  readonly expiresAt: number
}

const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes

export class TokenCache {
  private cache = new Map<string, CachedAuth>()

  get(key: string): CachedAuth | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }
    return entry
  }

  set(key: string, value: Omit<CachedAuth, 'expiresAt'>, ttlMs = DEFAULT_TTL_MS): void {
    this.cache.set(key, { ...value, expiresAt: Date.now() + ttlMs })
  }

  invalidate(key: string): void {
    this.cache.delete(key)
  }

  invalidateAll(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

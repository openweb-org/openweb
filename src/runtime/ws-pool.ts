import { WsConnectionManager, type WsConnectionConfig } from './ws-connection.js'

// ── Pool Config ───────────────────────────────────

export interface WsPoolConfig {
  /** Max idle time before closing an unused connection (ms). Default: 60_000 */
  readonly idleTimeoutMs?: number
  /** Max connections per pool key. Default: 4 */
  readonly maxConnectionsPerKey?: number
}

interface PoolEntry {
  readonly connection: WsConnectionManager
  readonly key: string
  refCount: number
  idleTimer: ReturnType<typeof setTimeout> | null
  readonly createdAt: number
}

// ── Pool ──────────────────────────────────────────

export class WsConnectionPool {
  private readonly entries = new Map<string, PoolEntry[]>()
  private readonly idleTimeoutMs: number
  private readonly maxPerKey: number
  private nextId = 1

  constructor(config: WsPoolConfig = {}) {
    this.idleTimeoutMs = config.idleTimeoutMs ?? 60_000
    this.maxPerKey = config.maxConnectionsPerKey ?? 4
  }

  /** Build a pool key from site + server URL + auth fingerprint */
  static buildKey(site: string, serverUrl: string, authType?: string): string {
    return `${site}::${serverUrl}::${authType ?? 'none'}`
  }

  /** Acquire a connection for the given key and config. Reuses existing if available. */
  acquire(key: string, config: WsConnectionConfig): WsConnectionManager {
    const entries = this.entries.get(key)

    // Try to reuse an existing connection that's READY
    if (entries) {
      for (const entry of entries) {
        const state = entry.connection.getState()
        if (state === 'READY' || state === 'AUTHENTICATING' || state === 'CONNECTING') {
          // Clear idle timer, bump refCount
          if (entry.idleTimer) {
            clearTimeout(entry.idleTimer)
            entry.idleTimer = null
          }
          entry.refCount++
          return entry.connection
        }
      }
    }

    // Check max connections limit
    const activeCount = entries?.filter(e => {
      const s = e.connection.getState()
      return s !== 'CLOSED' && s !== 'DISCONNECTED'
    }).length ?? 0

    if (activeCount >= this.maxPerKey) {
      // Return the least-used active connection
      const sorted = entries?.filter(e => {
        const s = e.connection.getState()
        return s !== 'CLOSED' && s !== 'DISCONNECTED'
      }).sort((a, b) => a.refCount - b.refCount)
      const entry = sorted?.[0]
      if (!entry) throw new Error('No active connection found for pool key')
      entry.refCount++
      return entry.connection
    }

    // Create new connection
    const conn = new WsConnectionManager(config)
    const entry: PoolEntry = {
      connection: conn,
      key,
      refCount: 1,
      idleTimer: null,
      createdAt: Date.now(),
    }

    if (!this.entries.has(key)) {
      this.entries.set(key, [])
    }
    this.entries.get(key)?.push(entry)

    // Clean up closed entries on close
    conn.on('stateChange', (_from, to) => {
      if (to === 'CLOSED') {
        this.removeEntry(key, conn)
      }
    })

    return conn
  }

  /** Release a connection (decrement refCount). Starts idle timer if no refs remain. */
  release(key: string, connection: WsConnectionManager): void {
    const entries = this.entries.get(key)
    if (!entries) return

    const entry = entries.find(e => e.connection === connection)
    if (!entry) return

    entry.refCount = Math.max(0, entry.refCount - 1)
    if (entry.refCount === 0) {
      entry.idleTimer = setTimeout(() => {
        entry.connection.destroy()
        this.removeEntry(key, connection)
      }, this.idleTimeoutMs)
    }
  }

  /** Get current pool size for a key */
  size(key: string): number {
    return this.entries.get(key)?.length ?? 0
  }

  /** Destroy all connections and clear the pool */
  destroyAll(): void {
    for (const key of Array.from(this.entries.keys())) {
      const entries = this.entries.get(key)
      if (!entries) continue
      for (const entry of entries) {
        if (entry.idleTimer) clearTimeout(entry.idleTimer)
        entry.connection.destroy()
      }
    }
    this.entries.clear()
  }

  private removeEntry(key: string, connection: WsConnectionManager): void {
    const entries = this.entries.get(key)
    if (!entries) return
    const idx = entries.findIndex(e => e.connection === connection)
    if (idx >= 0) {
      const entry = entries[idx]
      if (!entry) return
      if (entry.idleTimer) clearTimeout(entry.idleTimer)
      entries.splice(idx, 1)
    }
    if (entries.length === 0) {
      this.entries.delete(key)
    }
  }
}

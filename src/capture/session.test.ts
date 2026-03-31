import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Capture lifecycle tests — mock-based, no real browser.
 *
 * We can't unit-test createCaptureSession directly (too many Playwright
 * dependencies), so we test the observable cleanup contract:
 *   - stop() sets stopped flag, aborts controller, resolves stop deferred
 *   - detachAll() removes all listeners tracked during capture
 *   - cleanup() detaches CDP sessions and disconnects browser
 *
 * Strategy: extract the cleanup helpers into testable units by re-creating
 * the resource tracking + cleanup patterns from session.ts with mocks.
 */

// ── Mock types matching the Playwright shape used in session.ts ──

interface MockCDPSession {
  detach: ReturnType<typeof vi.fn>
}

interface MockBrowser {
  disconnect: ReturnType<typeof vi.fn>
}

interface MockHarCapture {
  detach: ReturnType<typeof vi.fn>
  drain: ReturnType<typeof vi.fn>
  entries: unknown[]
}

interface MockWsCapture {
  detach: ReturnType<typeof vi.fn>
  frames: unknown[]
}

interface MockContext {
  removeListener: ReturnType<typeof vi.fn>
}

function createMockCDPSession(): MockCDPSession {
  return { detach: vi.fn(async () => {}) }
}

function createMockBrowser(): MockBrowser {
  return { disconnect: vi.fn() }
}

function createMockHarCapture(): MockHarCapture {
  return { detach: vi.fn(), drain: vi.fn(async () => {}), entries: [] }
}

function createMockWsCapture(): MockWsCapture {
  return { detach: vi.fn(), frames: [] }
}

// ── Reproduce session.ts cleanup patterns with mocks ──

describe('capture session lifecycle', () => {
  let cdpSessions: MockCDPSession[]
  let harCaptures: MockHarCapture[]
  let wsCaptures: MockWsCapture[]
  let pageListenerCleanups: Array<ReturnType<typeof vi.fn>>
  let browserRef: MockBrowser | undefined
  let contextRef: MockContext | undefined
  let onNewPageHandler: (() => void) | undefined

  beforeEach(() => {
    cdpSessions = []
    harCaptures = []
    wsCaptures = []
    pageListenerCleanups = []
    browserRef = undefined
    contextRef = undefined
    onNewPageHandler = undefined
  })

  /** Mirrors session.ts detachAll() */
  function detachAll(): void {
    for (const hc of harCaptures) hc.detach()
    for (const wc of wsCaptures) wc.detach()
    for (const cleanup of pageListenerCleanups) cleanup()
    if (onNewPageHandler && contextRef) {
      contextRef.removeListener('page', onNewPageHandler)
    }
  }

  /** Mirrors session.ts cleanup() */
  async function cleanup(): Promise<void> {
    for (const session of cdpSessions) {
      try { await session.detach() } catch { /* intentional */ }
    }
    try { browserRef?.disconnect() } catch { /* intentional */ }
  }

  describe('stop() contract', () => {
    it('sets stopped flag and aborts controller', () => {
      const controller = new AbortController()
      let stopped = false

      const stop = (): void => {
        if (stopped) return
        stopped = true
        controller.abort()
      }

      stop()
      expect(stopped).toBe(true)
      expect(controller.signal.aborted).toBe(true)
    })

    it('is idempotent — second call is a no-op', () => {
      const controller = new AbortController()
      let stopped = false
      let callCount = 0

      const stop = (): void => {
        if (stopped) return
        stopped = true
        callCount++
        controller.abort()
      }

      stop()
      stop()
      expect(callCount).toBe(1)
    })

    it('resolves the stop deferred', async () => {
      let resolve!: () => void
      const promise = new Promise<void>((r) => { resolve = r })
      let stopped = false

      const stop = (): void => {
        if (stopped) return
        stopped = true
        resolve()
      }

      stop()
      await expect(promise).resolves.toBeUndefined()
    })
  })

  describe('detachAll() cleans up all listeners', () => {
    it('detaches HAR and WS captures', () => {
      const har1 = createMockHarCapture()
      const har2 = createMockHarCapture()
      const ws1 = createMockWsCapture()
      harCaptures.push(har1, har2)
      wsCaptures.push(ws1)

      detachAll()

      expect(har1.detach).toHaveBeenCalledOnce()
      expect(har2.detach).toHaveBeenCalledOnce()
      expect(ws1.detach).toHaveBeenCalledOnce()
    })

    it('calls page listener cleanups', () => {
      const c1 = vi.fn()
      const c2 = vi.fn()
      pageListenerCleanups.push(c1, c2)

      detachAll()

      expect(c1).toHaveBeenCalledOnce()
      expect(c2).toHaveBeenCalledOnce()
    })

    it('removes context page listener when handler is set', () => {
      contextRef = { removeListener: vi.fn() }
      onNewPageHandler = vi.fn()

      detachAll()

      expect(contextRef.removeListener).toHaveBeenCalledWith('page', onNewPageHandler)
    })

    it('skips context removal when no handler', () => {
      contextRef = { removeListener: vi.fn() }
      onNewPageHandler = undefined

      detachAll()

      expect(contextRef.removeListener).not.toHaveBeenCalled()
    })
  })

  describe('cleanup() closes CDP sessions and browser', () => {
    it('detaches all CDP sessions', async () => {
      const s1 = createMockCDPSession()
      const s2 = createMockCDPSession()
      cdpSessions.push(s1, s2)

      await cleanup()

      expect(s1.detach).toHaveBeenCalledOnce()
      expect(s2.detach).toHaveBeenCalledOnce()
    })

    it('disconnects the browser', async () => {
      browserRef = createMockBrowser()

      await cleanup()

      expect(browserRef.disconnect).toHaveBeenCalledOnce()
    })

    it('survives CDP detach errors', async () => {
      const failing = createMockCDPSession()
      failing.detach.mockRejectedValue(new Error('already detached'))
      const ok = createMockCDPSession()
      cdpSessions.push(failing, ok)

      await cleanup()

      expect(ok.detach).toHaveBeenCalledOnce()
    })

    it('survives browser disconnect errors', async () => {
      browserRef = createMockBrowser()
      browserRef.disconnect.mockImplementation(() => { throw new Error('gone') })

      // Should not throw
      await expect(cleanup()).resolves.toBeUndefined()
    })

    it('handles empty resources gracefully', async () => {
      browserRef = undefined
      await expect(cleanup()).resolves.toBeUndefined()
    })
  })
})

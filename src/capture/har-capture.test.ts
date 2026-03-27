import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Page, Request, Response } from 'playwright'
import { attachHarCapture } from './har-capture.js'

// ── Helpers to simulate Playwright page events ──────────────────

type Listener = (...args: unknown[]) => void

function createMockPage() {
  const listeners = new Map<string, Listener[]>()
  const page = {
    on(event: string, fn: Listener) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)?.push(fn)
    },
    removeListener(event: string, fn: Listener) {
      const fns = listeners.get(event)
      if (fns) listeners.set(event, fns.filter((f) => f !== fn))
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args)
    },
  }
  return page as unknown as Page & { emit: (event: string, ...args: unknown[]) => void }
}

function createMockRequest(url: string, method = 'GET', postData?: string): Request {
  return {
    url: () => url,
    method: () => method,
    postData: () => postData ?? null,
    allHeaders: vi.fn().mockResolvedValue({}),
  } as unknown as Request
}

function createMockResponse(
  req: Request,
  status: number,
  headers: Record<string, string>,
  body: Buffer,
): Response {
  return {
    request: () => req,
    status: () => status,
    statusText: () => (status === 200 ? 'OK' : 'Error'),
    allHeaders: vi.fn().mockResolvedValue(headers),
    body: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('HAR capture — body-size-gate', () => {
  let page: Page & { emit: (event: string, ...args: unknown[]) => void }

  beforeEach(() => {
    page = createMockPage()
  })

  it('captures body when size <= 1 MB', async () => {
    const capture = attachHarCapture(page)
    const req = createMockRequest('https://api.example.com/data')
    const body = Buffer.from('{"ok":true}')
    const res = createMockResponse(req, 200, { 'content-type': 'application/json' }, body)

    page.emit('request', req)
    page.emit('response', res)
    await capture.drain()

    expect(capture.entries).toHaveLength(1)
    expect(capture.entries[0]?.response.content.text).toBe('{"ok":true}')
  })

  it('omits body but records metadata when size > 1 MB', async () => {
    const capture = attachHarCapture(page)
    const req = createMockRequest('https://api.example.com/big')
    const largeBody = Buffer.alloc(1_048_577, 'x') // 1 byte over limit
    const res = createMockResponse(req, 200, { 'content-type': 'application/json' }, largeBody)

    page.emit('request', req)
    page.emit('response', res)
    await capture.drain()

    expect(capture.entries).toHaveLength(1)
    const entry = capture.entries[0]
    expect(entry?.response.content.text).toBeUndefined()
    expect(entry?.request.url).toBe('https://api.example.com/big')
    expect(entry?.response.status).toBe(200)
    expect(entry?.response.content.mimeType).toBe('application/json')
  })

  it('captures body at exactly 1 MB boundary', async () => {
    const capture = attachHarCapture(page)
    const req = createMockRequest('https://api.example.com/edge')
    const exactBody = Buffer.alloc(1_048_576, 'a') // exactly 1 MB
    const res = createMockResponse(req, 200, { 'content-type': 'text/plain' }, exactBody)

    page.emit('request', req)
    page.emit('response', res)
    await capture.drain()

    expect(capture.entries).toHaveLength(1)
    expect(capture.entries[0]?.response.content.text).toBeDefined()
    expect(capture.entries[0]?.response.content.text?.length).toBe(1_048_576)
  })

  it('records ALL requests — no domain or content-type filtering', async () => {
    const capture = attachHarCapture(page)

    // Analytics domain — previously blocked, now captured
    const req1 = createMockRequest('https://google-analytics.com/collect')
    const res1 = createMockResponse(req1, 200, {}, Buffer.from(''))

    // Static asset path — previously blocked, now captured
    const req2 = createMockRequest('https://cdn.example.com/bundle.js')
    const res2 = createMockResponse(req2, 200, { 'content-type': 'application/javascript' }, Buffer.from('var x=1'))

    // HTML response — previously filtered, now captured
    const req3 = createMockRequest('https://example.com/page')
    const res3 = createMockResponse(req3, 200, { 'content-type': 'text/html' }, Buffer.from('<html></html>'))

    page.emit('request', req1)
    page.emit('request', req2)
    page.emit('request', req3)
    page.emit('response', res1)
    page.emit('response', res2)
    page.emit('response', res3)
    await capture.drain()

    expect(capture.entries).toHaveLength(3)
  })

  it('handles body-unavailable gracefully (still records metadata)', async () => {
    const capture = attachHarCapture(page)
    const req = createMockRequest('https://api.example.com/stream')
    const res = {
      request: () => req,
      status: () => 200,
      statusText: () => 'OK',
      allHeaders: vi.fn().mockResolvedValue({ 'content-type': 'text/event-stream' }),
      body: vi.fn().mockRejectedValue(new Error('Response body is unavailable for redirect responses')),
    } as unknown as Response

    page.emit('request', req)
    page.emit('response', res)
    await capture.drain()

    expect(capture.entries).toHaveLength(1)
    expect(capture.entries[0]?.response.content.text).toBeUndefined()
    expect(capture.entries[0]?.response.content.mimeType).toBe('text/event-stream')
  })

  it('does not export shouldCaptureRequest or isBlockedDomain', async () => {
    const mod = await import('./har-capture.js')
    expect('shouldCaptureRequest' in mod).toBe(false)
    expect('isBlockedDomain' in mod).toBe(false)
  })
})

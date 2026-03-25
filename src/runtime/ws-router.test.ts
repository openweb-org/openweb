import { describe, it, expect } from 'vitest'

import { WsRouter, type WsRouterConfig } from './ws-router.js'

// ── Test fixtures ────────────────────────────────────

/** Discord-style config: op field discriminates frame type */
function discordStyleConfig(): WsRouterConfig {
  return {
    discriminator: {
      sent: { field: 'op' },
      received: { field: 'op' },
    },
    controlPatterns: [
      { match: { op: 10 } }, // Hello
      { match: { op: 1 } },  // Heartbeat
    ],
    ackPatterns: [
      { match: { op: 11 } }, // Heartbeat ACK
    ],
    responsePattern: {
      correlationField: 'nonce',
    },
    eventRoutes: [
      { operationId: 'messageCreate', match: { op: 0, t: 'MESSAGE_CREATE' } },
      { operationId: 'presenceUpdate', match: { op: 0, t: 'PRESENCE_UPDATE' } },
    ],
  }
}

/** Minimal config with no patterns — everything should be 'unknown' */
function emptyConfig(): WsRouterConfig {
  return {
    discriminator: {
      sent: { field: 'type' },
      received: { field: 'type' },
    },
    controlPatterns: [],
    ackPatterns: [],
    eventRoutes: [],
  }
}

// ── Tests ────────────────────────────────────────────

describe('WsRouter.classify', () => {
  describe('all 5 categories', () => {
    const router = new WsRouter(discordStyleConfig())

    it('classifies control frames', () => {
      const result = router.classify({ op: 10, d: { heartbeat_interval: 41250 } })
      expect(result.category).toBe('control')
      expect(result.operationId).toBeUndefined()
    })

    it('classifies ack frames', () => {
      const result = router.classify({ op: 11 })
      expect(result.category).toBe('ack')
    })

    it('classifies response frames via correlation field', () => {
      const result = router.classify({ op: 0, nonce: '12345', d: { content: 'hi' } })
      expect(result.category).toBe('response')
    })

    it('classifies event frames with operationId', () => {
      const result = router.classify({ op: 0, t: 'MESSAGE_CREATE', d: { content: 'hello' } })
      expect(result.category).toBe('event')
      expect(result.operationId).toBe('messageCreate')
    })

    it('classifies unknown frames as unknown', () => {
      const result = router.classify({ op: 99, d: null })
      expect(result.category).toBe('unknown')
      expect(result.operationId).toBeUndefined()
    })
  })

  describe('unknown discriminator returns unknown (not event)', () => {
    const router = new WsRouter(emptyConfig())

    it('returns unknown for unmatched object', () => {
      const result = router.classify({ type: 'SOMETHING_UNEXPECTED', data: {} })
      expect(result.category).toBe('unknown')
    })

    it('returns unknown for object with no matching type field', () => {
      const result = router.classify({ foo: 'bar' })
      expect(result.category).toBe('unknown')
    })
  })

  describe('non-object payloads', () => {
    const router = new WsRouter(discordStyleConfig())

    it('returns unknown for null', () => {
      expect(router.classify(null).category).toBe('unknown')
    })

    it('returns unknown for string', () => {
      expect(router.classify('ping').category).toBe('unknown')
    })

    it('returns unknown for number', () => {
      expect(router.classify(42).category).toBe('unknown')
    })

    it('returns unknown for undefined', () => {
      expect(router.classify(undefined).category).toBe('unknown')
    })
  })

  describe('missing received discriminator', () => {
    it('returns unknown when received discriminator is null', () => {
      const config: WsRouterConfig = {
        discriminator: { sent: { field: 'op' }, received: null },
        controlPatterns: [{ match: { op: 10 } }],
        ackPatterns: [],
        eventRoutes: [],
      }
      const router = new WsRouter(config)
      expect(router.classify({ op: 10 }).category).toBe('unknown')
    })
  })

  describe('classification priority order', () => {
    it('control takes precedence over event with same fields', () => {
      const config: WsRouterConfig = {
        discriminator: {
          sent: { field: 'type' },
          received: { field: 'type' },
        },
        controlPatterns: [{ match: { type: 'ping' } }],
        ackPatterns: [],
        eventRoutes: [{ operationId: 'ping', match: { type: 'ping' } }],
      }
      const router = new WsRouter(config)
      expect(router.classify({ type: 'ping' }).category).toBe('control')
    })

    it('ack takes precedence over response', () => {
      const config: WsRouterConfig = {
        discriminator: {
          sent: { field: 'op' },
          received: { field: 'op' },
        },
        controlPatterns: [],
        ackPatterns: [{ match: { op: 11 } }],
        responsePattern: { correlationField: 'nonce' },
        eventRoutes: [],
      }
      const router = new WsRouter(config)
      // Has both ack-matching op AND a nonce — ack wins
      expect(router.classify({ op: 11, nonce: '123' }).category).toBe('ack')
    })

    it('response takes precedence over event', () => {
      const config: WsRouterConfig = {
        discriminator: {
          sent: { field: 'op' },
          received: { field: 'op' },
        },
        controlPatterns: [],
        ackPatterns: [],
        responsePattern: { correlationField: 'nonce' },
        eventRoutes: [{ operationId: 'msg', match: { op: 0, t: 'MSG' } }],
      }
      const router = new WsRouter(config)
      // Matches both response (has nonce) and event route — response wins
      expect(router.classify({ op: 0, t: 'MSG', nonce: '999' }).category).toBe('response')
    })
  })

  describe('nested discriminator fields', () => {
    it('matches nested field paths', () => {
      const config: WsRouterConfig = {
        discriminator: {
          sent: { field: 'header.type' },
          received: { field: 'header.type' },
        },
        controlPatterns: [{ match: { 'header.type': 'ping' } }],
        ackPatterns: [],
        eventRoutes: [],
      }
      const router = new WsRouter(config)
      expect(router.classify({ header: { type: 'ping' } }).category).toBe('control')
    })
  })

  describe('payload passthrough', () => {
    const router = new WsRouter(discordStyleConfig())

    it('returns the original payload in all categories', () => {
      const controlPayload = { op: 10 }
      expect(router.classify(controlPayload).payload).toBe(controlPayload)

      const unknownPayload = { op: 999 }
      expect(router.classify(unknownPayload).payload).toBe(unknownPayload)

      const eventPayload = { op: 0, t: 'MESSAGE_CREATE', d: {} }
      expect(router.classify(eventPayload).payload).toBe(eventPayload)
    })
  })
})

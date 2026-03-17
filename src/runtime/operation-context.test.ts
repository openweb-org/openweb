import { describe, expect, it } from 'vitest'

import { getServerXOpenWeb, resolveTransport } from './operation-context.js'
import type { OpenApiSpec } from '../lib/openapi.js'

describe('getServerXOpenWeb', () => {
  it('returns server x-openweb config', () => {
    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{
        url: 'https://api.example.com',
        'x-openweb': { transport: 'node', auth: { type: 'cookie_session' } },
      } as unknown as { url: string }],
      paths: { '/test': { get: { operationId: 'test' } } },
    }
    const op = spec.paths!['/test']!.get!
    const ext = getServerXOpenWeb(spec, op)
    expect(ext?.transport).toBe('node')
    expect(ext?.auth).toEqual({ type: 'cookie_session' })
  })

  it('returns undefined when no x-openweb', () => {
    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      paths: { '/test': { get: { operationId: 'test' } } },
    }
    expect(getServerXOpenWeb(spec, spec.paths!['/test']!.get!)).toBeUndefined()
  })
})

describe('resolveTransport', () => {
  it('reads transport from server-level x-openweb', () => {
    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{
        url: 'https://api.example.com',
        'x-openweb': { transport: 'page' },
      } as unknown as { url: string }],
      paths: { '/test': { get: { operationId: 'test' } } },
    }
    expect(resolveTransport(spec, spec.paths!['/test']!.get!)).toBe('page')
  })

  it('defaults to node when no x-openweb', () => {
    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      paths: { '/test': { get: { operationId: 'test' } } },
    }
    expect(resolveTransport(spec, spec.paths!['/test']!.get!)).toBe('node')
  })

  it('operation-level transport overrides server-level', () => {
    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{
        url: 'https://api.example.com',
        'x-openweb': { transport: 'node' },
      } as unknown as { url: string }],
      paths: { '/test': { get: { operationId: 'test', 'x-openweb': { transport: 'page' } } } },
    }
    expect(resolveTransport(spec, spec.paths!['/test']!.get!)).toBe('page')
  })
})

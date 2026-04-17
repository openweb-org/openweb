import { describe, expect, it } from 'vitest'

import type { OpenApiSpec } from '../lib/spec-loader.js'
import { getServerXOpenWeb, resolvePagePlan, resolveTransport } from './operation-context.js'

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
    const op = spec.paths?.['/test']?.get
    if (!op) throw new Error('missing op')
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
    const op = spec.paths?.['/test']?.get
    if (!op) throw new Error('missing op')
    expect(getServerXOpenWeb(spec, op)).toBeUndefined()
  })

  it('reads x-openweb from operation-level servers when spec servers differ', () => {
    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{
        url: 'https://us.example.com',
        'x-openweb': { transport: 'node' },
      } as unknown as { url: string }],
      paths: {
        '/api/data': {
          post: {
            operationId: 'getData',
            servers: [{
              url: 'https://www.example.com',
              'x-openweb': { transport: 'page' },
            }],
          },
        },
      },
    }
    const op = spec.paths?.['/api/data']?.post
    if (!op) throw new Error('missing op')
    const ext = getServerXOpenWeb(spec, op)
    expect(ext?.transport).toBe('page')
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
    const op = spec.paths?.['/test']?.get
    if (!op) throw new Error('missing op')
    expect(resolveTransport(spec, op)).toBe('page')
  })

  it('defaults to node when no x-openweb', () => {
    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      paths: { '/test': { get: { operationId: 'test' } } },
    }
    const op = spec.paths?.['/test']?.get
    if (!op) throw new Error('missing op')
    expect(resolveTransport(spec, op)).toBe('node')
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
    const op = spec.paths?.['/test']?.get
    if (!op) throw new Error('missing op')
    expect(resolveTransport(spec, op)).toBe('page')
  })
})

describe('resolvePagePlan', () => {
  const makeSpec = (serverPlan?: Record<string, unknown>, opPlan?: Record<string, unknown>): OpenApiSpec => ({
    openapi: '3.1.0',
    info: { title: 'T', version: '1.0' },
    servers: [{
      url: 'https://example.com',
      'x-openweb': { transport: 'page', ...(serverPlan ? { page_plan: serverPlan } : {}) },
    } as unknown as { url: string }],
    paths: {
      '/test': {
        get: {
          operationId: 'test',
          ...(opPlan ? { 'x-openweb': { page_plan: opPlan } } : {}),
        },
      },
    },
  })

  const opFrom = (spec: OpenApiSpec) => {
    const op = spec.paths?.['/test']?.get
    if (!op) throw new Error('missing op')
    return op
  }

  it('returns undefined when neither server nor operation defines page_plan', () => {
    const spec = makeSpec()
    expect(resolvePagePlan(spec, opFrom(spec))).toBeUndefined()
  })

  it('returns server plan when only server defines it', () => {
    const spec = makeSpec({ wait_until: 'domcontentloaded', warm: true })
    expect(resolvePagePlan(spec, opFrom(spec))).toEqual({
      wait_until: 'domcontentloaded',
      warm: true,
    })
  })

  it('operation fields override server fields', () => {
    const spec = makeSpec(
      { wait_until: 'load', warm: true, settle_ms: 1000 },
      { wait_until: 'networkidle' },
    )
    expect(resolvePagePlan(spec, opFrom(spec))).toEqual({
      wait_until: 'networkidle',
      warm: true,
      settle_ms: 1000,
    })
  })

  it('operation falsy values still override server', () => {
    const spec = makeSpec({ warm: true, settle_ms: 500 }, { warm: false, settle_ms: 0 })
    expect(resolvePagePlan(spec, opFrom(spec))).toEqual({
      warm: false,
      settle_ms: 0,
    })
  })

  it('operation entry_url overrides server entry_url', () => {
    const spec = makeSpec(
      { entry_url: 'https://example.com/server-entry' },
      { entry_url: 'https://example.com/op-entry' },
    )
    expect(resolvePagePlan(spec, opFrom(spec))?.entry_url).toBe('https://example.com/op-entry')
  })
})

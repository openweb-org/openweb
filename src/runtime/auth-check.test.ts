import { describe, expect, it } from 'vitest'

import { OpenWebError } from '../lib/errors.js'
import type { OpenApiOperation, OpenApiSpec } from '../lib/spec-loader.js'

import { applyAuthCheck } from './auth-check.js'

function spec(serverXOpenWeb?: Record<string, unknown>): OpenApiSpec {
  return {
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    servers: [{ url: 'https://x.test', ...(serverXOpenWeb ? { 'x-openweb': serverXOpenWeb } : {}) }],
    paths: {},
  } as unknown as OpenApiSpec
}

function op(opXOpenWeb?: Record<string, unknown>): OpenApiOperation {
  return {
    ...(opXOpenWeb ? { 'x-openweb': opXOpenWeb } : {}),
  } as unknown as OpenApiOperation
}

function expectNeedsLogin(fn: () => unknown): void {
  try {
    fn()
    throw new Error('expected throw')
  } catch (err) {
    expect(err).toBeInstanceOf(OpenWebError)
    expect((err as OpenWebError).payload.failureClass).toBe('needs_login')
    expect((err as OpenWebError).payload.code).toBe('AUTH_FAILED')
  }
}

describe('applyAuthCheck', () => {
  it('no rules → no-op', () => {
    expect(() => applyAuthCheck({ ok: true }, spec(), op())).not.toThrow()
  })

  it('equals match on path throws needs_login', () => {
    const rules = [{ path: 'error_code', equals: '60201' }]
    expectNeedsLogin(() =>
      applyAuthCheck({ error_code: '60201' }, spec({ auth_check: rules }), op()),
    )
  })

  it('contains match on path throws', () => {
    const rules = [{ path: 'message', contains: 'unauthorized' }]
    expectNeedsLogin(() =>
      applyAuthCheck({ message: 'User Unauthorized' }, spec({ auth_check: rules }), op()),
    )
  })

  it('path miss → no throw', () => {
    const rules = [{ path: 'error_code', equals: '60201' }]
    expect(() =>
      applyAuthCheck({ data: 1 }, spec({ auth_check: rules }), op()),
    ).not.toThrow()
  })

  it('numeric vs string equals are coerced', () => {
    const rules = [{ path: 'error_code', equals: 60201 }]
    expectNeedsLogin(() =>
      applyAuthCheck({ error_code: '60201' }, spec({ auth_check: rules }), op()),
    )
    const rules2 = [{ path: 'error_code', equals: '60201' }]
    expectNeedsLogin(() =>
      applyAuthCheck({ error_code: 60201 }, spec({ auth_check: rules2 }), op()),
    )
  })

  it('multiple rules OR match', () => {
    const rules = [
      { path: 'error_code', equals: '99999' },
      { path: 'message', contains: 'login' },
    ]
    expectNeedsLogin(() =>
      applyAuthCheck({ message: 'please login' }, spec({ auth_check: rules }), op()),
    )
  })

  it('op-level auth_check: false disables server-level rules', () => {
    const rules = [{ path: 'error_code', equals: '60201' }]
    expect(() =>
      applyAuthCheck({ error_code: '60201' }, spec({ auth_check: rules }), op({ auth_check: false })),
    ).not.toThrow()
  })

  it('op-level rules override server-level', () => {
    const serverRules = [{ path: 'a', equals: '1' }]
    const opRules = [{ path: 'b', equals: '2' }]
    expect(() =>
      applyAuthCheck({ a: '1' }, spec({ auth_check: serverRules }), op({ auth_check: opRules })),
    ).not.toThrow()
    expectNeedsLogin(() =>
      applyAuthCheck({ b: '2' }, spec({ auth_check: serverRules }), op({ auth_check: opRules })),
    )
  })

  it('contains is case-insensitive', () => {
    const rules = [{ path: 'msg', contains: 'EXPIRED' }]
    expectNeedsLogin(() =>
      applyAuthCheck({ msg: 'session expired' }, spec({ auth_check: rules }), op()),
    )
  })

  it('rule with no path matches against the body itself (string body)', () => {
    const rules = [{ contains: 'login required' }]
    expectNeedsLogin(() =>
      applyAuthCheck('Login required', spec({ auth_check: rules }), op()),
    )
  })
})

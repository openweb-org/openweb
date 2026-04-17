import { describe, expect, it } from 'vitest'

import { getServerUrl } from './spec-loader.js'
import type { OpenApiOperation, OpenApiSpec } from './spec-loader.js'

const op: OpenApiOperation = { operationId: 'test' }

function spec(servers: OpenApiSpec['servers']): OpenApiSpec {
  return {
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    servers,
    paths: {},
  }
}

describe('getServerUrl', () => {
  it('returns URL unchanged when no variables', () => {
    const s = spec([{ url: 'https://api.example.com' }])
    expect(getServerUrl(s, op)).toBe('https://api.example.com')
  })

  it('substitutes caller-provided params over defaults', () => {
    const s = spec([
      {
        url: 'https://{subdomain}.substack.com',
        variables: { subdomain: { default: 'www' } },
      },
    ])
    expect(getServerUrl(s, op, { subdomain: 'stratechery' })).toBe('https://stratechery.substack.com')
  })

  it('falls back to variable default when param absent', () => {
    const s = spec([
      {
        url: 'https://{subdomain}.substack.com',
        variables: { subdomain: { default: 'www' } },
      },
    ])
    expect(getServerUrl(s, op)).toBe('https://www.substack.com')
  })

  it('prefers operation-level server over global', () => {
    const s = spec([{ url: 'https://global.example.com' }])
    const opWithServer: OpenApiOperation = {
      operationId: 'test',
      servers: [
        {
          url: 'https://{region}.api.example.com',
          variables: { region: { default: 'us' } },
        },
      ],
    }
    expect(getServerUrl(s, opWithServer, { region: 'eu' })).toBe('https://eu.api.example.com')
  })

  it('substitutes multiple variables in one URL', () => {
    const s = spec([
      {
        url: 'https://{sub}.example.{tld}',
        variables: { sub: { default: 'www' }, tld: { default: 'com' } },
      },
    ])
    expect(getServerUrl(s, op, { sub: 'api', tld: 'io' })).toBe('https://api.example.io')
  })

  it('throws when a placeholder has no param and no declared default (OAS 3.x strictness)', () => {
    const s = spec([{ url: 'https://{unknown}.example.com' }])
    expect(() => getServerUrl(s, op)).toThrow(/\{unknown\}/)
  })

  it('coerces numeric params with String()', () => {
    const s = spec([
      { url: 'https://api.example.com:{port}', variables: { port: { default: '443' } } },
    ])
    expect(getServerUrl(s, op, { port: 8080 })).toBe('https://api.example.com:8080')
  })

  it('coerces boolean params with String()', () => {
    const s = spec([
      { url: 'https://{flag}.example.com', variables: { flag: { default: 'false' } } },
    ])
    expect(getServerUrl(s, op, { flag: true })).toBe('https://true.example.com')
  })

  it('rejects values containing URL-unsafe characters', () => {
    const s = spec([
      { url: 'https://{subdomain}.example.com', variables: { subdomain: { default: 'www' } } },
    ])
    expect(() => getServerUrl(s, op, { subdomain: 'evil.com/path' })).toThrow(/URL-unsafe/)
    expect(() => getServerUrl(s, op, { subdomain: 'a b' })).toThrow(/URL-unsafe/)
    expect(() => getServerUrl(s, op, { subdomain: 'foo?x=1' })).toThrow(/URL-unsafe/)
    expect(() => getServerUrl(s, op, { subdomain: 'evil@host' })).toThrow(/URL-unsafe/)
  })
})

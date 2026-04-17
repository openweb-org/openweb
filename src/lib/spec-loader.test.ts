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

  it('leaves unknown placeholders unchanged when no default and no param', () => {
    const s = spec([{ url: 'https://{unknown}.example.com' }])
    expect(getServerUrl(s, op)).toBe('https://{unknown}.example.com')
  })
})

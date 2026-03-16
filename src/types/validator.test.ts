import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { validateManifest, validateXOpenWebSpec } from './validator.js'

const FIXTURES_DIR = path.join(import.meta.dirname, '..', 'fixtures')

function loadFixture(name: string) {
  const dir = path.join(FIXTURES_DIR, name)
  return {
    async spec() {
      const raw = await readFile(path.join(dir, 'openapi.yaml'), 'utf8')
      return parse(raw) as Record<string, unknown>
    },
    async manifest() {
      const raw = await readFile(path.join(dir, 'manifest.json'), 'utf8')
      return JSON.parse(raw) as unknown
    },
  }
}

describe('validateXOpenWebSpec', () => {
  it('passes for L1-only spec (open-meteo, no server-level x-openweb primitives)', async () => {
    const spec = await loadFixture('open-meteo-fixture').spec()
    const result = validateXOpenWebSpec(spec)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('passes for L2 spec (instagram with cookie_session + cookie_to_header)', async () => {
    const spec = await loadFixture('instagram-fixture').spec()
    const result = validateXOpenWebSpec(spec)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects invalid server-level x-openweb', () => {
    const spec = {
      servers: [{ url: 'https://example.com', 'x-openweb': { mode: 'invalid_mode' } }],
      paths: {},
    }
    const result = validateXOpenWebSpec(spec)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects invalid auth primitive type', () => {
    const spec = {
      servers: [
        {
          url: 'https://example.com',
          'x-openweb': {
            mode: 'direct_http',
            auth: { type: 'nonexistent_auth' },
          },
        },
      ],
      paths: {},
    }
    const result = validateXOpenWebSpec(spec)
    expect(result.valid).toBe(false)
  })

  it('rejects invalid operation-level x-openweb', () => {
    const spec = {
      servers: [],
      paths: {
        '/test': {
          get: {
            operationId: 'test',
            'x-openweb': { risk_tier: 'invalid_tier' },
          },
        },
      },
    }
    const result = validateXOpenWebSpec(spec)
    expect(result.valid).toBe(false)
  })

  it('validates cursor pagination primitive', () => {
    const spec = {
      paths: {
        '/feed': {
          get: {
            operationId: 'getFeed',
            'x-openweb': {
              pagination: {
                type: 'cursor',
                response_field: 'next_cursor',
                request_param: 'cursor',
              },
            },
          },
        },
      },
    }
    const result = validateXOpenWebSpec(spec)
    expect(result.valid).toBe(true)
  })

  it('validates extraction primitive', () => {
    const spec = {
      paths: {
        '/page': {
          get: {
            operationId: 'getPage',
            'x-openweb': {
              extraction: {
                type: 'ssr_next_data',
                path: 'props.pageProps',
              },
            },
          },
        },
      },
    }
    const result = validateXOpenWebSpec(spec)
    expect(result.valid).toBe(true)
  })

  it('passes for spec with no x-openweb at all', () => {
    const spec = {
      servers: [{ url: 'https://example.com' }],
      paths: {
        '/test': { get: { operationId: 'test' } },
      },
    }
    const result = validateXOpenWebSpec(spec)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

describe('validateManifest', () => {
  it('passes for open-meteo manifest', async () => {
    const manifest = await loadFixture('open-meteo-fixture').manifest()
    const result = validateManifest(manifest)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('passes for instagram manifest', async () => {
    const manifest = await loadFixture('instagram-fixture').manifest()
    const result = validateManifest(manifest)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects manifest missing required fields', () => {
    const result = validateManifest({ name: 'test' })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects manifest with invalid stats', () => {
    const result = validateManifest({
      name: 'test',
      version: '1.0.0',
      spec_version: '2.0',
      stats: { operation_count: 'not_a_number' },
    })
    expect(result.valid).toBe(false)
  })

  it('passes minimal valid manifest', () => {
    const result = validateManifest({
      name: 'minimal',
      version: '0.1.0',
      spec_version: '1.0',
    })
    expect(result.valid).toBe(true)
  })
})

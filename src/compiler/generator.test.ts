import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import type { AnalyzedOperation } from './types.js'
import { generatePackage } from './generator.js'

function op(partial: Partial<AnalyzedOperation> & Pick<AnalyzedOperation, 'operationId' | 'host' | 'path'>): AnalyzedOperation {
  return {
    method: 'get',
    summary: partial.operationId,
    parameters: partial.parameters ?? [],
    responseSchema: partial.responseSchema ?? { type: 'object', properties: {} },
    exampleInput: partial.exampleInput ?? {},
    verified: partial.verified ?? true,
    ...partial,
  }
}

describe('generatePackage', () => {
  it('writes openapi, manifest, and test files', async () => {
    const outputBaseDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-generator-test-'))

    try {
      const outputRoot = await generatePackage({
        site: 'sample-site',
        sourceUrl: 'https://example.com',
        outputBaseDir,
        operations: [
          op({
            operationId: 'search_location',
            host: 'geo.example.com',
            path: '/v1/search',
            responseSchema: {
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      latitude: { type: 'number' },
                      longitude: { type: 'number' },
                    },
                  },
                },
              },
            },
            parameters: [
              { name: 'name', required: true, schema: { type: 'string' }, exampleValue: 'Berlin' },
            ],
            exampleInput: { name: 'Berlin' },
          }),
          op({
            operationId: 'get_forecast',
            host: 'api.example.com',
            path: '/v1/forecast',
            parameters: [
              { name: 'latitude', required: true, schema: { type: 'number' }, exampleValue: 52.52 },
              { name: 'longitude', required: true, schema: { type: 'number' }, exampleValue: 13.41 },
            ],
            exampleInput: { latitude: 52.52, longitude: 13.41 },
          }),
        ],
      })

      const manifestRaw = await readFile(path.join(outputRoot, 'manifest.json'), 'utf8')
      const manifest = JSON.parse(manifestRaw) as { dependencies?: Record<string, string> }
      expect(manifest.dependencies).toEqual({
        'search_location.results[].latitude': 'get_forecast.latitude',
        'search_location.results[].longitude': 'get_forecast.longitude',
      })

      const openapiRaw = await readFile(path.join(outputRoot, 'openapi.yaml'), 'utf8')
      expect(openapiRaw).toContain('openapi: 3.1.0')
      expect(openapiRaw).toContain('operationId: search_location')

      const testRaw = await readFile(path.join(outputRoot, 'tests', 'get_forecast.test.json'), 'utf8')
      expect(testRaw).toContain('"operation_id": "get_forecast"')
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('emits server-level x-openweb when classify result is provided', async () => {
    const outputBaseDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-generator-l2-test-'))

    try {
      const outputRoot = await generatePackage({
        site: 'instagram-test',
        sourceUrl: 'https://www.instagram.com',
        outputBaseDir,
        classify: {
          transport: 'node',
          auth: { type: 'cookie_session' },
          csrf: { type: 'cookie_to_header', cookie: 'csrftoken', header: 'X-CSRFToken' },
        },
        operations: [
          op({
            operationId: 'getTimeline',
            host: 'www.instagram.com',
            path: '/api/v1/feed/timeline/',
          }),
        ],
      })

      const openapiRaw = await readFile(path.join(outputRoot, 'openapi.yaml'), 'utf8')
      expect(openapiRaw).toContain('transport: node')
      expect(openapiRaw).toContain('type: cookie_session')
      expect(openapiRaw).toContain('cookie: csrftoken')
      expect(openapiRaw).toContain('header: X-CSRFToken')

      const manifestRaw = await readFile(path.join(outputRoot, 'manifest.json'), 'utf8')
      const manifest = JSON.parse(manifestRaw) as { requires_auth: boolean }
      expect(manifest.requires_auth).toBe(true)
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })
})

import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import type { AnalyzedOperation } from './types.js'
import { generatePackage } from './generator/index.js'

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
      const manifest = JSON.parse(manifestRaw) as Record<string, unknown>
      expect(manifest.name).toBe('sample-site')
      expect(manifest.dependencies).toBeUndefined()

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

  it('emits signing in server-level x-openweb', async () => {
    const outputBaseDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-generator-signing-test-'))

    try {
      const outputRoot = await generatePackage({
        site: 'youtube-test',
        sourceUrl: 'https://www.youtube.com',
        outputBaseDir,
        classify: {
          transport: 'node',
          auth: { type: 'cookie_session' },
          signing: {
            type: 'sapisidhash',
            origin: 'https://www.youtube.com',
            inject: { header: 'Authorization', prefix: 'SAPISIDHASH ' },
          },
        },
        operations: [
          op({
            operationId: 'getVideoInfo',
            host: 'www.youtube.com',
            path: '/youtubei/v1/player',
          }),
        ],
      })

      const openapiRaw = await readFile(path.join(outputRoot, 'openapi.yaml'), 'utf8')
      expect(openapiRaw).toContain('type: sapisidhash')
      expect(openapiRaw).toContain('origin: https://www.youtube.com')
      expect(openapiRaw).toContain('signing_detected')
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('emits extraction operations from classify signals', async () => {
    const outputBaseDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-generator-extraction-test-'))

    try {
      const outputRoot = await generatePackage({
        site: 'walmart-test',
        sourceUrl: 'https://www.walmart.com',
        outputBaseDir,
        classify: {
          transport: 'node',
          extractions: [
            { type: 'ssr_next_data', selector: 'script#__NEXT_DATA__', estimatedSize: 5000 },
          ],
        },
        operations: [],
      })

      const openapiRaw = await readFile(path.join(outputRoot, 'openapi.yaml'), 'utf8')
      expect(openapiRaw).toContain('extract_next_data')
      expect(openapiRaw).toContain('type: ssr_next_data')
      expect(openapiRaw).toContain('extraction_detected')

      // Test file should exist but not assert response_schema_valid
      const testRaw = await readFile(path.join(outputRoot, 'tests', 'extract_next_data.test.json'), 'utf8')
      const testData = JSON.parse(testRaw) as { cases: Array<{ assertions: Record<string, unknown> }> }
      expect(testData.cases[0]?.assertions.status).toBe(200)
      expect(testData.cases[0]?.assertions).not.toHaveProperty('response_schema_valid')
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('emits script_json extraction with selector', async () => {
    const outputBaseDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-generator-scriptjson-test-'))

    try {
      const outputRoot = await generatePackage({
        site: 'github-test',
        sourceUrl: 'https://github.com',
        outputBaseDir,
        classify: {
          transport: 'node',
          auth: { type: 'cookie_session' },
          extractions: [
            { type: 'script_json', id: 'repo-data', selector: 'script#repo-data', estimatedSize: 2000 },
          ],
        },
        operations: [],
      })

      const openapiRaw = await readFile(path.join(outputRoot, 'openapi.yaml'), 'utf8')
      expect(openapiRaw).toContain('extract_repo_data')
      expect(openapiRaw).toContain('type: script_json')
      expect(openapiRaw).toContain('script#repo-data')
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('includes build signals with status-match when verified', async () => {
    const outputBaseDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-generator-signals-test-'))

    try {
      const outputRoot = await generatePackage({
        site: 'signal-test',
        sourceUrl: 'https://example.com',
        outputBaseDir,
        classify: {
          transport: 'node',
          auth: { type: 'cookie_session' },
        },
        operations: [
          op({
            operationId: 'getStuff',
            host: 'example.com',
            path: '/api/stuff',
            verified: true,
          }),
        ],
      })

      const openapiRaw = await readFile(path.join(outputRoot, 'openapi.yaml'), 'utf8')
      expect(openapiRaw).toContain('status-match')
      expect(openapiRaw).toContain('auth_detected')
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })
})

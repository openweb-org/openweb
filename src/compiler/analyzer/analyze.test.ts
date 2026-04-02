import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CaptureBundle } from '../types-v2.js'
import { analyzeCapture } from './analyze.js'

// ── Minimal HAR fixture ──────────────────────────────────────────────────────

function makeMinimalHar() {
  return {
    log: {
      entries: [
        {
          startedDateTime: '2025-01-01T00:00:00Z',
          time: 50,
          request: {
            method: 'GET',
            url: 'https://api.example.com/v1/users',
            headers: [
              { name: 'Cookie', value: 'sessionid=abc123' },
              { name: 'Referer', value: 'https://example.com/dashboard' },
            ],
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: [{ name: 'content-type', value: 'application/json' }],
            content: {
              size: 50,
              mimeType: 'application/json',
              text: JSON.stringify({ users: [{ id: 1, name: 'Alice' }] }),
            },
          },
        },
        {
          startedDateTime: '2025-01-01T00:00:01Z',
          time: 30,
          request: {
            method: 'GET',
            url: 'https://cdn.example.com/static/logo.png',
            headers: [],
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: [{ name: 'content-type', value: 'image/png' }],
            content: { size: 1000, mimeType: 'image/png' },
          },
        },
        {
          startedDateTime: '2025-01-01T00:00:02Z',
          time: 20,
          request: {
            method: 'GET',
            url: 'https://api.example.com/v1/users/42',
            headers: [
              { name: 'Cookie', value: 'sessionid=abc123' },
              { name: 'Referer', value: 'https://example.com/dashboard' },
            ],
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: [{ name: 'content-type', value: 'application/json' }],
            content: {
              size: 30,
              mimeType: 'application/json',
              text: JSON.stringify({ id: 42, name: 'Bob' }),
            },
          },
        },
      ],
    },
  }
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('analyzeCapture', () => {
  let captureDir: string

  beforeAll(async () => {
    captureDir = await mkdtemp(path.join(os.tmpdir(), 'analyze-test-'))
    await writeFile(path.join(captureDir, 'traffic.har'), JSON.stringify(makeMinimalHar()))
    // Empty state snapshots (no auth)
    await writeFile(path.join(captureDir, 'state_snapshots.json'), '[]')
    // Create empty dom_extractions dir
    await mkdir(path.join(captureDir, 'dom_extractions'), { recursive: true })
  })

  afterAll(async () => {
    await rm(captureDir, { recursive: true, force: true })
  })

  it('produces a valid AnalysisReport from a minimal capture', async () => {
    const bundle: CaptureBundle = {
      site: 'test-site',
      sourceUrl: 'https://example.com',
      captureDir,
      harPath: path.join(captureDir, 'traffic.har'),
    }

    const report = await analyzeCapture(bundle)

    // Top-level structure
    expect(report.version).toBe(2)
    expect(report.site).toBe('test-site')
    expect(report.sourceUrl).toBe('https://example.com')
    expect(report.generatedAt).toBeTruthy()

    // Samples — all 3 should be labeled
    expect(report.samples.length).toBe(3)
    for (const s of report.samples) {
      expect(s.id).toBeTruthy()
      expect(s.category).toBeTruthy()
      expect(s.reasons.length).toBeGreaterThan(0)
    }

    // Summary
    expect(report.summary.totalSamples).toBe(3)
    expect(report.summary.malformedSamples).toBe(0)
    expect(typeof report.summary.byCategory.api).toBe('number')
    expect(typeof report.summary.byCategory.static).toBe('number')
    expect(typeof report.summary.byResponseKind.json).toBe('number')
    expect(report.summary.clusterCount).toBe(report.clusters.length)

    // Clusters — at least 1 cluster from the api samples
    if (report.summary.byCategory.api > 0) {
      expect(report.clusters.length).toBeGreaterThan(0)
      for (const c of report.clusters) {
        expect(c.id).toMatch(/^cluster-/)
        expect(c.method).toBeTruthy()
        expect(c.host).toBeTruthy()
        expect(c.pathTemplate).toBeTruthy()
        expect(c.suggestedOperationId).toBeTruthy()
        expect(c.suggestedSummary).toBeTruthy()
        expect(c.sampleCount).toBeGreaterThan(0)
        expect(Array.isArray(c.responseVariants)).toBe(true)
        expect(Array.isArray(c.parameters)).toBe(true)
      }
    }

    // Auth candidates — always at least 1 (possibly "none")
    expect(report.authCandidates.length).toBeGreaterThan(0)
    for (const a of report.authCandidates) {
      expect(a.id).toMatch(/^auth-/)
      expect(typeof a.rank).toBe('number')
      expect(typeof a.confidence).toBe('number')
      expect(a.evidence).toBeDefined()
    }

    // Navigation groups
    expect(Array.isArray(report.navigation)).toBe(true)

    // Extraction signals
    expect(Array.isArray(report.extractionSignals)).toBe(true)
  })

  it('labels static content as non-api', async () => {
    const bundle: CaptureBundle = {
      site: 'test-site',
      sourceUrl: 'https://example.com',
      captureDir,
      harPath: path.join(captureDir, 'traffic.har'),
    }

    const report = await analyzeCapture(bundle)
    const staticSamples = report.samples.filter((s) => s.category === 'static')
    // The logo.png request should be static
    expect(staticSamples.length).toBeGreaterThanOrEqual(1)
  })

  it('clusters api samples with response variants', async () => {
    const bundle: CaptureBundle = {
      site: 'test-site',
      sourceUrl: 'https://example.com',
      captureDir,
      harPath: path.join(captureDir, 'traffic.har'),
    }

    const report = await analyzeCapture(bundle)
    const apiClusters = report.clusters.filter((c) => c.sampleCount > 0)

    for (const cluster of apiClusters) {
      expect(cluster.responseVariants.length).toBeGreaterThan(0)
      for (const rv of cluster.responseVariants) {
        expect(typeof rv.status).toBe('number')
        expect(rv.kind).toBeTruthy()
        expect(typeof rv.sampleCount).toBe('number')
      }
    }
  })

  it('generates deterministic cluster and auth IDs', async () => {
    const bundle: CaptureBundle = {
      site: 'test-site',
      sourceUrl: 'https://example.com',
      captureDir,
      harPath: path.join(captureDir, 'traffic.har'),
    }

    const first = await analyzeCapture(bundle)
    const second = await analyzeCapture(bundle)

    expect(first.clusters.map((c) => c.id)).toEqual(second.clusters.map((c) => c.id))
    expect(first.authCandidates.map((a) => a.id)).toEqual(second.authCandidates.map((a) => a.id))
  })

  it('scopes auth inference to API-labeled entries only (B1)', async () => {
    // Create a HAR where a tracking-domain entry carries a cookie header
    // that would incorrectly trigger cookie_session auth if not filtered.
    const harWithTracking = {
      log: {
        entries: [
          // API entry — no auth cookies
          {
            startedDateTime: '2025-01-01T00:00:00Z',
            time: 50,
            request: {
              method: 'GET',
              url: 'https://api.example.com/v1/public',
              headers: [{ name: 'Accept', value: 'application/json' }],
            },
            response: {
              status: 200,
              statusText: 'OK',
              headers: [{ name: 'content-type', value: 'application/json' }],
              content: { size: 10, mimeType: 'application/json', text: '{}' },
            },
          },
          // Tracking entry — has cookie that would trigger auth
          {
            startedDateTime: '2025-01-01T00:00:01Z',
            time: 30,
            request: {
              method: 'GET',
              url: 'https://www.google-analytics.com/collect',
              headers: [{ name: 'Cookie', value: 'sessionid=abc123' }],
            },
            response: {
              status: 200,
              statusText: 'OK',
              headers: [{ name: 'content-type', value: 'image/gif' }],
              content: { size: 1, mimeType: 'image/gif' },
            },
          },
        ],
      },
    }

    const trackingDir = await mkdtemp(path.join(os.tmpdir(), 'analyze-b1-'))
    await writeFile(path.join(trackingDir, 'traffic.har'), JSON.stringify(harWithTracking))
    // State snapshot with the cookie name matching the tracking entry
    await writeFile(path.join(trackingDir, 'state_snapshots.json'), JSON.stringify([{
      timestamp: '2025-01-01T00:00:00Z',
      trigger: 'initial',
      url: 'https://example.com',
      localStorage: {},
      sessionStorage: {},
      cookies: [{
        name: 'sessionid',
        value: 'abc123',
        domain: '.example.com',
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
        expires: -1,
      }],
    }]))
    await mkdir(path.join(trackingDir, 'dom_extractions'), { recursive: true })

    try {
      const bundle: CaptureBundle = {
        site: 'test-b1',
        sourceUrl: 'https://example.com',
        captureDir: trackingDir,
        harPath: path.join(trackingDir, 'traffic.har'),
      }

      const report = await analyzeCapture(bundle)
      // The tracking entry should be labeled non-api (tracking/off_domain)
      // so auth should NOT detect cookie_session from it
      const cookieAuth = report.authCandidates.find(c => c.auth?.type === 'cookie_session')
      expect(cookieAuth).toBeUndefined()
      // Should have a "none" candidate since the API entry has no auth
      expect(report.authCandidates.find(c => c.auth === undefined)).toBeDefined()
    } finally {
      await rm(trackingDir, { recursive: true, force: true })
    }
  })
})

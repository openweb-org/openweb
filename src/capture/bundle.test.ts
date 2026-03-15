import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeCaptureBundle, type CaptureData } from './bundle.js'

describe('writeCaptureBundle', () => {
  let outputDir: string

  beforeEach(async () => {
    outputDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-bundle-test-'))
  })

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true })
  })

  function makeCaptureData(overrides?: Partial<CaptureData>): CaptureData {
    return {
      harLog: { version: '1.2', creator: { name: 'openweb', version: '0.1.0' }, entries: [] },
      wsFrames: [],
      stateSnapshots: [],
      domExtractions: [],
      metadata: {
        siteUrl: 'https://example.com',
        startTime: '2026-03-15T10:00:00.000Z',
        endTime: '2026-03-15T10:05:00.000Z',
        pageCount: 1,
        requestCount: 0,
        wsConnectionCount: 0,
        snapshotCount: 0,
        captureVersion: '0.1.0',
      },
      ...overrides,
    }
  }

  it('writes minimal bundle with all required files', async () => {
    await writeCaptureBundle(outputDir, makeCaptureData())

    const files = await readdir(outputDir, { recursive: true })
    expect(files).toContain('traffic.har')
    expect(files).toContain('metadata.json')
    expect(files).toContain('state_snapshots')
    expect(files).toContain('dom_extractions')
    // No websocket_frames.jsonl when empty
    expect(files).not.toContain('websocket_frames.jsonl')

    const metadata = JSON.parse(await readFile(path.join(outputDir, 'metadata.json'), 'utf8'))
    expect(metadata.siteUrl).toBe('https://example.com')
    expect(metadata.captureVersion).toBe('0.1.0')
  })

  it('writes WebSocket JSONL when frames exist', async () => {
    const data = makeCaptureData({
      wsFrames: [
        { connectionId: 'ws1', timestamp: '2026-03-15T10:00:00.000Z', type: 'open', url: 'wss://example.com/ws' },
        {
          connectionId: 'ws1',
          timestamp: '2026-03-15T10:00:01.000Z',
          type: 'frame',
          direction: 'received',
          opcode: 1,
          payload: '{"hello":"world"}',
        },
      ],
    })

    await writeCaptureBundle(outputDir, data)

    const jsonl = await readFile(path.join(outputDir, 'websocket_frames.jsonl'), 'utf8')
    const lines = jsonl.trim().split('\n')
    expect(lines).toHaveLength(2)

    const first = JSON.parse(lines[0] ?? '')
    expect(first.type).toBe('open')
    expect(first.url).toBe('wss://example.com/ws')
  })

  it('writes numbered state snapshot and DOM extraction files', async () => {
    const data = makeCaptureData({
      stateSnapshots: [
        {
          timestamp: '2026-03-15T10:00:00.000Z',
          trigger: 'initial',
          url: 'https://example.com',
          localStorage: { key: 'value' },
          sessionStorage: {},
          cookies: [],
        },
        {
          timestamp: '2026-03-15T10:01:00.000Z',
          trigger: 'navigation',
          url: 'https://example.com/page2',
          localStorage: { key: 'value2' },
          sessionStorage: {},
          cookies: [],
        },
      ],
      domExtractions: [
        {
          timestamp: '2026-03-15T10:00:00.000Z',
          trigger: 'initial',
          url: 'https://example.com',
          metaTags: [],
          scriptJsonTags: [],
          hiddenInputs: [],
          globals: {},
          webpackChunks: [],
          gapiAvailable: false,
        },
      ],
    })

    await writeCaptureBundle(outputDir, data)

    const snapshots = await readdir(path.join(outputDir, 'state_snapshots'))
    expect(snapshots).toContain('001_initial.json')
    expect(snapshots).toContain('002_navigation.json')

    const extractions = await readdir(path.join(outputDir, 'dom_extractions'))
    expect(extractions).toContain('001_initial.json')

    const snapshot = JSON.parse(
      await readFile(path.join(outputDir, 'state_snapshots', '001_initial.json'), 'utf8'),
    )
    expect(snapshot.localStorage.key).toBe('value')
  })

  it('cleans stale artifacts from previous runs', async () => {
    // First run with 3 snapshots
    const data1 = makeCaptureData({
      stateSnapshots: [
        { timestamp: 't1', trigger: 'initial', url: 'https://example.com', localStorage: {}, sessionStorage: {}, cookies: [] },
        { timestamp: 't2', trigger: 'navigation', url: 'https://example.com/a', localStorage: {}, sessionStorage: {}, cookies: [] },
        { timestamp: 't3', trigger: 'navigation', url: 'https://example.com/b', localStorage: {}, sessionStorage: {}, cookies: [] },
      ],
      wsFrames: [
        { connectionId: 'ws1', timestamp: 't1', type: 'open', url: 'wss://example.com/ws' },
      ],
    })
    await writeCaptureBundle(outputDir, data1)

    const beforeSnapshots = await readdir(path.join(outputDir, 'state_snapshots'))
    expect(beforeSnapshots).toHaveLength(3)
    const beforeFiles = await readdir(outputDir)
    expect(beforeFiles).toContain('websocket_frames.jsonl')

    // Second run with only 1 snapshot and no WS
    const data2 = makeCaptureData({
      stateSnapshots: [
        { timestamp: 't4', trigger: 'initial', url: 'https://other.com', localStorage: {}, sessionStorage: {}, cookies: [] },
      ],
    })
    await writeCaptureBundle(outputDir, data2)

    // Stale snapshots from first run should be gone
    const afterSnapshots = await readdir(path.join(outputDir, 'state_snapshots'))
    expect(afterSnapshots).toHaveLength(1)
    expect(afterSnapshots).toContain('001_initial.json')

    // Stale websocket_frames.jsonl should be gone
    const afterFiles = await readdir(outputDir)
    expect(afterFiles).not.toContain('websocket_frames.jsonl')
  })
})

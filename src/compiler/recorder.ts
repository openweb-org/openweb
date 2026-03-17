import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'

import { OpenWebError } from '../lib/errors.js'
import type { RecordedRequestSample } from './types.js'
import type { CaptureData } from './analyzer/classify.js'
import type { HarEntry as CaptureHarEntry, StateSnapshot } from '../capture/types.js'

interface HarLog {
  readonly log?: {
    readonly entries?: HarEntry[]
  }
}

interface HarEntry {
  readonly startedDateTime?: string
  readonly time?: number
  readonly request?: {
    readonly method?: string
    readonly url?: string
    readonly headers?: Array<{ name?: string; value?: string }>
  }
  readonly response?: {
    readonly status?: number
    readonly statusText?: string
    readonly headers?: Array<{ name?: string; value?: string }>
    readonly content?: {
      readonly size?: number
      readonly mimeType?: string
      readonly text?: string
      readonly encoding?: string
    }
  }
}

function extractQuery(url: URL): Record<string, string[]> {
  const query: Record<string, string[]> = {}

  for (const [name, value] of url.searchParams.entries()) {
    if (!query[name]) {
      query[name] = []
    }
    query[name].push(value)
  }

  return query
}

export async function runScriptedRecording(scriptPath: string): Promise<string> {
  const recordingDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-recording-'))
  const resolvedScriptPath = path.resolve(process.cwd(), scriptPath)

  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', resolvedScriptPath, '--out', recordingDir], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(stderr || `record script exited with code ${String(code)}`))
    })
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Recording failed: ${message}`,
      action: 'Fix the record script and retry with `openweb compile <url> --script <file>`.',
      retriable: true,
      failureClass: 'retriable',
    })
  })

  return recordingDir
}

export async function loadRecordedSamples(recordingDir: string): Promise<RecordedRequestSample[]> {
  const harPath = path.join(recordingDir, 'traffic.har')
  const raw = await readFile(harPath, 'utf8')
  const har = JSON.parse(raw) as HarLog

  const samples: RecordedRequestSample[] = []

  for (const entry of har.log?.entries ?? []) {
    const method = entry.request?.method?.toUpperCase()
    const rawUrl = entry.request?.url
    const status = entry.response?.status
    const contentType =
      entry.response?.headers
        ?.find((header) => header.name?.toLowerCase() === 'content-type')
        ?.value?.toLowerCase() ?? entry.response?.content?.mimeType?.toLowerCase() ?? ''

    if (!method || !rawUrl || status === undefined) {
      continue
    }

    const parsedUrl = new URL(rawUrl)
    const encodedText = entry.response?.content?.text

    if (!encodedText) {
      continue
    }

    const encoding = entry.response?.content?.encoding?.toLowerCase()
    const responseText =
      encoding === 'base64' ? Buffer.from(encodedText, 'base64').toString('utf8') : encodedText

    let responseJson: unknown
    try {
      responseJson = JSON.parse(responseText)
    } catch {
      continue
    }

    samples.push({
      method,
      host: parsedUrl.hostname,
      path: parsedUrl.pathname,
      url: rawUrl,
      query: extractQuery(parsedUrl),
      status,
      contentType,
      responseJson,
    })
  }

  if (samples.length === 0) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No valid API samples found in recorded HAR.',
      action: 'Ensure the script issues successful JSON API requests.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return samples
}

export async function cleanupRecordingDir(recordingDir: string): Promise<void> {
  await rm(recordingDir, { recursive: true, force: true })
}

/**
 * Load full capture data from a recording directory for classify().
 * Reads: traffic.har (raw entries), state_snapshots.json, dom.html.
 * Missing files are treated as empty — only traffic.har is required.
 */
export async function loadCaptureData(recordingDir: string): Promise<CaptureData> {
  const harPath = path.join(recordingDir, 'traffic.har')
  const raw = await readFile(harPath, 'utf8')
  const har = JSON.parse(raw) as HarLog

  // Convert local HAR entries to capture module HarEntry format
  const harEntries: CaptureHarEntry[] = []
  for (const entry of har.log?.entries ?? []) {
    if (!entry.request?.method || !entry.request.url || entry.response?.status === undefined) continue

    const requestHeaders = (entry.request?.headers ?? [])
      .filter((h): h is { name: string; value: string } => Boolean(h?.name && h.value !== undefined))
      .map(h => ({ name: h.name, value: h.value }))

    const responseHeaders = (entry.response?.headers ?? [])
      .filter((h): h is { name: string; value: string } => Boolean(h?.name && h.value !== undefined))
      .map(h => ({ name: h.name, value: h.value }))

    const contentText = entry.response.content?.text
    const encoding = entry.response.content?.encoding?.toLowerCase()
    const decodedText = contentText && encoding === 'base64'
      ? Buffer.from(contentText, 'base64').toString('utf8')
      : contentText

    harEntries.push({
      startedDateTime: entry.startedDateTime ?? new Date().toISOString(),
      time: entry.time ?? 0,
      request: {
        method: entry.request.method,
        url: entry.request.url,
        headers: requestHeaders,
      },
      response: {
        status: entry.response.status,
        statusText: entry.response.statusText ?? '',
        headers: responseHeaders,
        content: {
          size: entry.response.content?.size ?? 0,
          mimeType: entry.response.content?.mimeType ?? '',
          text: decodedText,
        },
      },
    })
  }

  // Load state snapshots if available
  let stateSnapshots: StateSnapshot[] = []
  try {
    const stateRaw = await readFile(path.join(recordingDir, 'state_snapshots.json'), 'utf8')
    stateSnapshots = JSON.parse(stateRaw) as StateSnapshot[]
  } catch {
    // No state snapshots — OK for L1 sites
  }

  // Load DOM HTML if available
  let domHtml: string | undefined
  try {
    domHtml = await readFile(path.join(recordingDir, 'dom.html'), 'utf8')
  } catch {
    // No DOM capture — OK
  }

  return { harEntries, stateSnapshots, domHtml }
}

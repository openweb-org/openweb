import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'

import { OpenWebError } from '../lib/errors.js'
import type { RecordedRequestSample } from './types.js'

interface HarLog {
  readonly log?: {
    readonly entries?: HarEntry[]
  }
}

interface HarEntry {
  readonly request?: {
    readonly method?: string
    readonly url?: string
  }
  readonly response?: {
    readonly status?: number
    readonly headers?: Array<{ name?: string; value?: string }>
    readonly content?: {
      readonly mimeType?: string
      readonly text?: string
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
    const responseText = entry.response?.content?.text

    if (!responseText) {
      continue
    }

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
    })
  }

  return samples
}

export async function cleanupRecordingDir(recordingDir: string): Promise<void> {
  await rm(recordingDir, { recursive: true, force: true })
}

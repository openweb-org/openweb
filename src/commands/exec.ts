import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { OpenWebError } from '../lib/errors.js'
import { executeOperation } from '../runtime/executor.js'
import { getManagedCdpEndpoint } from './browser.js'

function parseParams(paramsJson: string | undefined): Record<string, unknown> {
  if (!paramsJson) return {}

  try {
    const parsed = JSON.parse(paramsJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Parameters must be a JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'INVALID_PARAMS',
      message: `Invalid JSON parameters (${detail}). Expected object string, e.g. {"latitude":52.52}`,
      action: 'Run `openweb <site> <tool>` to inspect parameters.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
}

export interface ExecOptions {
  readonly cdpEndpoint?: string
  readonly maxResponse?: number
  readonly output?: 'stdout' | 'file'
}

function spillToFile(text: string): string {
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 12)
  return join(tmpdir(), `openweb-${hash}.json`)
}

export async function execCommand(
  site: string,
  tool: string,
  paramsJson: string | undefined,
  options: ExecOptions = {},
): Promise<void> {
  const params = parseParams(paramsJson)

  // CDP auto-detect: managed browser → explicit flag
  const cdpEndpoint = options.cdpEndpoint ?? await getManagedCdpEndpoint()

  const result = await executeOperation(site, tool, params, {
    cdpEndpoint,
  })

  const text = JSON.stringify(result.body)
  const byteSize = Buffer.byteLength(text, 'utf8')
  const maxResponse = options.maxResponse ?? 4096

  if (options.output === 'file') {
    // Always write to file, return path on stdout
    const filePath = spillToFile(text)
    await writeFile(filePath, text, 'utf8')
    process.stdout.write(`${JSON.stringify({ status: result.status, output: filePath, size: byteSize })}\n`)
    return
  }

  // Default: stdout with auto-spill when over max-response
  if (byteSize > maxResponse) {
    const filePath = spillToFile(text)
    await writeFile(filePath, text, 'utf8')
    process.stdout.write(`${JSON.stringify({ status: result.status, output: filePath, size: byteSize, truncated: true })}\n`)
  } else {
    process.stdout.write(`${text}\n`)
  }
}

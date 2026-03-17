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
}

function truncateJsonPreview(text: string, maxResponse: number): string {
  let preview = ''
  let serialized = '""'

  for (const char of text) {
    const nextPreview = preview + char
    const nextSerialized = JSON.stringify(nextPreview)
    if (Buffer.byteLength(nextSerialized, 'utf8') > maxResponse) {
      break
    }
    preview = nextPreview
    serialized = nextSerialized
  }

  return serialized
}

function serializeBody(body: unknown, maxResponse: number | undefined): { text: string; truncated: boolean } {
  const text = JSON.stringify(body)
  if (maxResponse === undefined) {
    return { text, truncated: false }
  }

  if (Buffer.byteLength(text, 'utf8') <= maxResponse) {
    return { text, truncated: false }
  }

  return {
    // When truncated, stdout stays valid JSON by switching to a JSON string preview.
    text: truncateJsonPreview(text, maxResponse),
    truncated: true,
  }
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
  const serialized = serializeBody(result.body, options.maxResponse)
  process.stdout.write(`${serialized.text}\n`)
  if (serialized.truncated && options.maxResponse !== undefined) {
    process.stderr.write(`warning: truncated at ${options.maxResponse} bytes\n`)
  }
}

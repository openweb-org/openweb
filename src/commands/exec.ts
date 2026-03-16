import { OpenWebError } from '../lib/errors.js'
import { executeOperation } from '../runtime/executor.js'

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

function serializeBody(body: unknown, maxResponse: number | undefined): { text: string; truncated: boolean } {
  const text = JSON.stringify(body)
  if (maxResponse === undefined) {
    return { text, truncated: false }
  }

  const encoded = Buffer.from(text, 'utf8')
  if (encoded.byteLength <= maxResponse) {
    return { text, truncated: false }
  }

  return {
    text: encoded.subarray(0, maxResponse).toString('utf8'),
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
  const result = await executeOperation(site, tool, params, {
    cdpEndpoint: options.cdpEndpoint,
  })
  const serialized = serializeBody(result.body, options.maxResponse)
  process.stdout.write(`${serialized.text}\n`)
  if (serialized.truncated && options.maxResponse !== undefined) {
    process.stderr.write(`warning: truncated at ${options.maxResponse} bytes\n`)
  }
}

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
    })
  }
}

export interface ExecOptions {
  readonly cdpEndpoint?: string
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
  process.stdout.write(`${JSON.stringify(result.body)}\n`)
}

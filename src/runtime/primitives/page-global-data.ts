import { OpenWebError } from '../../lib/errors.js'
import { getValueAtPath } from '../value-path.js'
import type { BrowserHandle } from './types.js'
import { evaluatePageExpression } from './page-expression.js'

export interface PageGlobalDataConfig {
  readonly expression: string
  readonly path?: string
}

export async function resolvePageGlobalData(
  handle: BrowserHandle,
  config: PageGlobalDataConfig,
): Promise<unknown> {
  const globalData = await evaluatePageExpression(handle, config.expression, {
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
  })

  if (globalData === undefined || globalData === null) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Page global expression "${config.expression}" returned no value.`,
      action: 'Open the matching page and ensure the global is initialized.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  if (!config.path) {
    return globalData
  }

  const value = getValueAtPath(globalData, config.path)
  if (value === undefined) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Path "${config.path}" was not found in page global "${config.expression}".`,
      action: 'Update the fixture path to match the current page data.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return value
}

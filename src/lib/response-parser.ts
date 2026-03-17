import { OpenWebError } from '../lib/errors.js'

/** Parse response body as JSON, throwing on failure */
export function parseResponseBody(text: string, contentType: string | null, status: number): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Response is not valid JSON (status ${status})`,
      action: 'The API returned non-JSON content. Check the endpoint.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
}

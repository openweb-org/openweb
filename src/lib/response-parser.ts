import { OpenWebError } from '../lib/errors.js'

/** Parse response body as JSON, returning raw text for binary content types */
export function parseResponseBody(text: string, contentType: string | null, status: number): unknown {
  // 204 No Content or empty body — return null
  if (!text || status === 204) return null

  // Binary content types (protobuf, octet-stream) — return raw text
  const ct = contentType ?? ''
  if (ct.includes('octet-stream') || ct.includes('protobuf')) {
    return text
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Response is not valid JSON (status ${status}, content-type: ${ct || 'none'})`,
      action: 'The API returned non-JSON content. Check the endpoint.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
}

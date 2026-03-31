import { openwebHome } from './config.js'

export type OpenWebErrorCode =
  | 'EXECUTION_FAILED'
  | 'TOOL_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'AUTH_FAILED'

export type FailureClass =
  | 'needs_browser'
  | 'needs_login'
  | 'needs_page'
  | 'permission_denied'
  | 'permission_required'
  | 'retriable'
  | 'fatal'

export interface OpenWebErrorPayload {
  readonly error: 'execution_failed' | 'auth'
  readonly code: OpenWebErrorCode
  readonly message: string
  readonly action: string
  readonly retriable: boolean
  readonly failureClass: FailureClass
  /** Retry-After value from HTTP response header (seconds or HTTP-date string) */
  readonly retryAfter?: string
}

export function getHttpFailure(status: number): Pick<OpenWebErrorPayload, 'failureClass' | 'retriable'> {
  if (status === 401 || status === 403) {
    return {
      failureClass: 'needs_login',
      retriable: true,
    }
  }

  if (status === 429 || status >= 500) {
    return {
      failureClass: 'retriable',
      retriable: true,
    }
  }

  return {
    failureClass: 'fatal',
    retriable: false,
  }
}

export class OpenWebError extends Error {
  public readonly payload: OpenWebErrorPayload

  constructor(payload: OpenWebErrorPayload) {
    super(payload.message)
    this.name = 'OpenWebError'
    this.payload = payload
  }

  static needsBrowser(): OpenWebError {
    return new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: 'No browser context available.',
      action: 'Run: openweb browser start',
      retriable: true, failureClass: 'needs_browser',
    })
  }

  static needsPage(url: string): OpenWebError {
    return new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: `No open page matches ${url}`,
      action: `Open a tab to ${url} and retry.`,
      retriable: true, failureClass: 'needs_page',
    })
  }

  static needsLogin(): OpenWebError {
    return new OpenWebError({
      error: 'auth', code: 'AUTH_FAILED',
      message: 'Authentication required.',
      action: 'Run: openweb login <site>, then: openweb browser restart',
      retriable: true, failureClass: 'needs_login',
    })
  }

  static unsupportedPrimitive(type: string): OpenWebError {
    return new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: `Unsupported primitive: ${type}`,
      action: 'This primitive type is not yet implemented.',
      retriable: false, failureClass: 'fatal',
    })
  }

  static httpError(status: number): OpenWebError {
    const failure = getHttpFailure(status)
    return new OpenWebError({
      error: failure.failureClass === 'needs_login' ? 'auth' : 'execution_failed',
      code: failure.failureClass === 'needs_login' ? 'AUTH_FAILED' : 'EXECUTION_FAILED',
      message: `HTTP ${status}`,
      action: failure.failureClass === 'needs_login'
        ? 'Run: openweb login <site>, then: openweb browser restart'
        : 'Check parameters and endpoint availability.',
      retriable: failure.retriable,
      failureClass: failure.failureClass,
    })
  }

  static permissionDenied(site: string, operationId: string, category: string): OpenWebError {
    return new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Permission denied: ${category} on ${site}/${operationId}`,
      action: `Update ${openwebHome()}/permissions.yaml to allow '${category}' for '${site}'.`,
      retriable: false,
      failureClass: 'permission_denied',
    })
  }

  static unknownOp(operation: string): OpenWebError {
    return new OpenWebError({
      error: 'execution_failed', code: 'TOOL_NOT_FOUND',
      message: `Unknown operation: ${operation}`,
      action: 'Check the operation name.',
      retriable: false, failureClass: 'fatal',
    })
  }

  static missingParam(name: string): OpenWebError {
    return new OpenWebError({
      error: 'execution_failed', code: 'INVALID_PARAMS',
      message: `Missing required parameter: ${name}`,
      action: `Provide the '${name}' parameter.`,
      retriable: false, failureClass: 'fatal',
    })
  }

  static apiError(label: string, message: string): OpenWebError {
    return new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: `${label}: ${message}`,
      action: 'Check the query parameters.',
      retriable: false, failureClass: 'fatal',
    })
  }

  static permissionRequired(site: string, operationId: string, category: string): OpenWebError {
    return new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Permission required: ${category} on ${site}/${operationId}`,
      action: `This operation requires '${category}' permission. Update ${openwebHome()}/permissions.yaml to allow it.`,
      retriable: false,
      failureClass: 'permission_required',
    })
  }
}

export function writeErrorToStderr(payload: OpenWebErrorPayload): void {
  process.stderr.write(`${JSON.stringify(payload)}\n`)
}

export function toOpenWebError(error: unknown): OpenWebError {
  if (error instanceof OpenWebError) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  return new OpenWebError({
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
    message,
    action: 'Retry the command or inspect the site/tool definition.',
    retriable: true,
    failureClass: 'retriable',
  })
}

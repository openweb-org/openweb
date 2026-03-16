export type OpenWebErrorCode =
  | 'EXECUTION_FAILED'
  | 'TOOL_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'AUTH_FAILED'

export type FailureClass =
  | 'needs_browser'
  | 'needs_login'
  | 'needs_page'
  | 'retriable'
  | 'fatal'

export interface OpenWebErrorPayload {
  readonly error: 'execution_failed' | 'auth'
  readonly code: OpenWebErrorCode
  readonly message: string
  readonly action: string
  readonly retriable: boolean
  readonly failureClass: FailureClass
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

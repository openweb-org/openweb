import type { JsonSchema } from '../lib/spec-loader.js'

export type SampleResponse =
  | { readonly kind: 'json'; readonly body: unknown }
  | { readonly kind: 'text'; readonly body: string }
  | { readonly kind: 'empty' }

export interface RecordedRequestSample {
  readonly method: string
  readonly host: string
  readonly path: string
  readonly url: string
  readonly query: Record<string, string[]>
  readonly status: number
  readonly contentType: string
  readonly response: SampleResponse
  readonly requestBody?: string
  /** ISO-8601 timestamp from the HAR entry (for navigation grouping) */
  readonly startedDateTime?: string
  /** Referer header value from the request (for navigation grouping) */
  readonly referer?: string
  /** Non-standard request headers (for constant header detection) */
  readonly requestHeaders?: ReadonlyArray<{ readonly name: string; readonly value: string }>
}

export interface ClusteredEndpoint {
  readonly method: string
  readonly host: string
  readonly path: string
  readonly samples: RecordedRequestSample[]
}

export interface ParameterDescriptor {
  readonly name: string
  readonly location: 'query' | 'path' | 'header'
  readonly required: boolean
  readonly schema: JsonSchema
  readonly description?: string
  readonly exampleValue: unknown
}

export interface AnalyzedOperation {
  readonly method: string
  readonly host: string
  readonly path: string
  readonly operationId: string
  readonly summary: string
  readonly parameters: ParameterDescriptor[]
  readonly responseSchema: JsonSchema
  readonly requestBodySchema?: JsonSchema
  readonly exampleRequestBody?: unknown
  readonly exampleInput: Record<string, unknown>
  readonly verified: boolean
}

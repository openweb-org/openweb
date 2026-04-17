import { describe, expect, it } from 'vitest'

import type { OpenApiOperation } from '../lib/spec-loader.js'
import { buildFormRequestBody, buildJsonRequestBody, buildRequestBody } from './request-builder.js'

function formOperation(): OpenApiOperation {
  return {
    operationId: 'submitForm',
    requestBody: {
      required: true,
      content: {
        'application/x-www-form-urlencoded': {
          schema: {
            type: 'object',
            properties: {
              user_id: { type: 'string' },
              action: { type: 'string' },
            },
            required: ['user_id', 'action'],
          },
        },
      },
    },
  } as unknown as OpenApiOperation
}

function jsonOperation(): OpenApiOperation {
  return {
    operationId: 'submitJson',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              user_id: { type: 'string' },
              action: { type: 'string' },
            },
            required: ['user_id', 'action'],
          },
        },
      },
    },
  } as unknown as OpenApiOperation
}

describe('buildRequestBody', () => {
  it('form-urlencoded parity: returns same wire body + content-type for a form operation', () => {
    const op = formOperation()
    const params = { user_id: '12345', action: 'follow' }

    const result = buildRequestBody(op, params)
    expect(result).toBeDefined()
    expect(result?.contentType).toBe('application/x-www-form-urlencoded')
    expect(result?.body).toBe('user_id=12345&action=follow')
    // parity with legacy helper
    expect(result?.body).toBe(buildFormRequestBody(op, params))
  })

  it('json path: returns JSON body with application/json content-type', () => {
    const op = jsonOperation()
    const params = { user_id: '12345', action: 'follow' }

    const result = buildRequestBody(op, params)
    expect(result).toBeDefined()
    expect(result?.contentType).toBe('application/json')
    expect(JSON.parse(result?.body ?? '')).toEqual({ user_id: '12345', action: 'follow' })
    expect(result?.body).toBe(buildJsonRequestBody(op, params))
  })

  it('returns undefined when body is empty and not required', () => {
    const op = {
      operationId: 'noBody',
      requestBody: {
        required: false,
        content: {
          'application/json': { schema: { type: 'object', properties: {} } },
        },
      },
    } as unknown as OpenApiOperation
    expect(buildRequestBody(op, {})).toBeUndefined()
  })

  it('form body URL-encodes special characters', () => {
    const op = formOperation()
    const result = buildRequestBody(op, { user_id: 'a b&c', action: 'x=y' })
    // URLSearchParams encodes space as '+' and & as %26, = as %3D
    expect(result?.body).toBe('user_id=a+b%26c&action=x%3Dy')
  })
})

function graphqlOperation(xOpenWeb: Record<string, unknown>): OpenApiOperation {
  return {
    operationId: 'gqlOp',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
            },
          },
        },
      },
    },
    'x-openweb': xOpenWeb,
  } as unknown as OpenApiOperation
}

describe('buildJsonRequestBody — graphql_hash (Apollo APQ)', () => {
  it('hash-only: emits extensions.persistedQuery with variables wrapped', () => {
    const op = graphqlOperation({ wrap: 'variables', graphql_hash: 'abc123' })
    const body = JSON.parse(buildJsonRequestBody(op, { userId: 'u1' }) ?? '')
    expect(body).toEqual({
      variables: { userId: 'u1' },
      extensions: { persistedQuery: { version: 1, sha256Hash: 'abc123' } },
    })
    expect(body.query).toBeUndefined()
  })

  it('hash + query fallback: both included for APQ cache-miss recovery', () => {
    const op = graphqlOperation({
      wrap: 'variables',
      graphql_hash: 'abc123',
      graphql_query: 'query Q($userId: ID!) { user(id: $userId) { name } }',
    })
    const body = JSON.parse(buildJsonRequestBody(op, { userId: 'u1' }) ?? '')
    expect(body.query).toBe('query Q($userId: ID!) { user(id: $userId) { name } }')
    expect(body.extensions).toEqual({ persistedQuery: { version: 1, sha256Hash: 'abc123' } })
    expect(body.variables).toEqual({ userId: 'u1' })
  })

  it("strips 'sha256:' prefix from hash", () => {
    const op = graphqlOperation({ wrap: 'variables', graphql_hash: 'sha256:deadbeef' })
    const body = JSON.parse(buildJsonRequestBody(op, { userId: 'u1' }) ?? '')
    expect(body.extensions.persistedQuery.sha256Hash).toBe('deadbeef')
  })

  it('works without wrap: extensions emitted, params at root', () => {
    const op = graphqlOperation({ graphql_hash: 'abc123' })
    const body = JSON.parse(buildJsonRequestBody(op, { userId: 'u1' }) ?? '')
    expect(body).toEqual({
      userId: 'u1',
      extensions: { persistedQuery: { version: 1, sha256Hash: 'abc123' } },
    })
  })
})

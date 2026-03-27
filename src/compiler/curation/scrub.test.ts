import { describe, expect, it } from 'vitest'

import { scrubExamples, scrubRequestBody } from './scrub.js'

describe('scrubExamples', () => {
  it('redacts sensitive keys regardless of value', () => {
    const input = {
      password: 'hunter2',
      secret: 'my-secret',
      token: 'abc',
      apiKey: 'key-123',
      api_key: 'key-456',
    }
    const result = scrubExamples(input)
    expect(result.password).toBe('<REDACTED>')
    expect(result.secret).toBe('<REDACTED>')
    expect(result.token).toBe('<REDACTED>')
    expect(result.apiKey).toBe('<REDACTED>')
    expect(result.api_key).toBe('<REDACTED>')
  })

  it('redacts cookie values', () => {
    const result = scrubExamples({ Cookie: 'sessionid=abc123', 'set-cookie': 'foo=bar' })
    expect(result.Cookie).toBe('<REDACTED_COOKIE>')
    expect(result['set-cookie']).toBe('<REDACTED_COOKIE>')
  })

  it('redacts long token-like strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const result = scrubExamples({ authorization: jwt })
    expect(result.authorization).toBe('<REDACTED_TOKEN>')
  })

  it('redacts long base64-only strings', () => {
    const base64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const result = scrubExamples({ data: base64 })
    expect(result.data).toBe('<REDACTED_TOKEN>')
  })

  it('replaces email addresses', () => {
    const result = scrubExamples({ email: 'alice@company.com' })
    expect(result.email).toBe('user@example.com')
  })

  it('replaces phone numbers', () => {
    const result = scrubExamples({ phone: '+1 (555) 123-4567' })
    expect(result.phone).toBe('+1-555-0100')
  })

  it('keeps normal string values', () => {
    const result = scrubExamples({ query: 'cats', format: 'json' })
    expect(result.query).toBe('cats')
    expect(result.format).toBe('json')
  })

  it('keeps numeric and boolean values', () => {
    const result = scrubExamples({ page: 1, limit: 20, active: true })
    expect(result.page).toBe(1)
    expect(result.limit).toBe(20)
    expect(result.active).toBe(true)
  })

  it('handles empty input', () => {
    expect(scrubExamples({})).toEqual({})
  })

  it('does not redact short strings that happen to be base64', () => {
    const result = scrubExamples({ id: 'abc123' })
    expect(result.id).toBe('abc123')
  })
})

describe('scrubRequestBody', () => {
  it('scrubs nested objects', () => {
    const body = {
      user: {
        password: 'hunter2',
        email: 'alice@company.com',
        name: 'Alice',
      },
    }
    const result = scrubRequestBody(body) as Record<string, Record<string, unknown>>
    expect(result.user.password).toBe('<REDACTED>')
    expect(result.user.email).toBe('user@example.com')
    expect(result.user.name).toBe('Alice')
  })

  it('scrubs arrays', () => {
    const body = ['alice@corp.com', 'normal string', 42]
    const result = scrubRequestBody(body) as unknown[]
    expect(result[0]).toBe('user@example.com')
    expect(result[1]).toBe('normal string')
    expect(result[2]).toBe(42)
  })

  it('handles null and undefined', () => {
    expect(scrubRequestBody(null)).toBeNull()
    expect(scrubRequestBody(undefined)).toBeUndefined()
  })

  it('handles primitive values', () => {
    expect(scrubRequestBody(42)).toBe(42)
    expect(scrubRequestBody(true)).toBe(true)
    expect(scrubRequestBody('hello')).toBe('hello')
  })

  it('scrubs deeply nested structures', () => {
    const body = {
      level1: {
        level2: {
          secret: 'super-secret',
          data: [{ apiKey: 'key-123' }],
        },
      },
    }
    const result = scrubRequestBody(body) as Record<string, unknown>
    const level2 = (result.level1 as Record<string, unknown>).level2 as Record<string, unknown>
    expect(level2.secret).toBe('<REDACTED>')
    expect((level2.data as Array<Record<string, unknown>>)[0].apiKey).toBe('<REDACTED>')
  })

  it('sensitive key check is case-insensitive', () => {
    const body = { PASSWORD: 'pw', Token: 'tk', SECRET: 's' }
    const result = scrubRequestBody(body) as Record<string, unknown>
    expect(result.PASSWORD).toBe('<REDACTED>')
    expect(result.Token).toBe('<REDACTED>')
    expect(result.SECRET).toBe('<REDACTED>')
  })
})

import { describe, expect, it } from 'vitest'

import { parseResponseBody } from '../lib/response-parser.js'
import { OpenWebError } from '../lib/errors.js'

describe('parseResponseBody', () => {
  it('parses valid JSON', () => {
    expect(parseResponseBody('{"ok":true}', 'application/json', 200)).toEqual({ ok: true })
  })

  it('throws on invalid JSON', () => {
    expect(() => parseResponseBody('<html>', 'text/html', 200)).toThrow(OpenWebError)
  })

  it('parses JSON even without content-type', () => {
    expect(parseResponseBody('{"ok":true}', null, 200)).toEqual({ ok: true })
  })

  it('returns raw text for octet-stream content', () => {
    expect(parseResponseBody('binary-data', 'application/octet-stream', 200)).toBe('binary-data')
  })

  it('returns raw text for protobuf content', () => {
    expect(parseResponseBody('proto-data', 'application/x-protobuf', 200)).toBe('proto-data')
  })
})

import { describe, expect, it } from 'vitest'

import { OpenWebError } from '../lib/errors.js'
import { parseResponseBody } from '../lib/response-parser.js'

describe('parseResponseBody', () => {
  it('parses valid JSON', () => {
    expect(parseResponseBody('{"ok":true}', 'application/json', 200)).toEqual({ ok: true })
  })

  it('returns raw text for HTML content', () => {
    expect(parseResponseBody('<html>', 'text/html', 200)).toBe('<html>')
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

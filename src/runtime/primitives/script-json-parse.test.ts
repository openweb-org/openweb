import { describe, expect, it } from 'vitest'

import { parseScriptContent, parseScriptJson } from './script-json-parse.js'

describe('parseScriptContent — strip_comments', () => {
  it('parses HTML-commented JSON when stripComments=true', () => {
    const raw = '\n<!--\n{"k":1}\n-->\n'
    expect(parseScriptContent(raw, 'script#x', { stripComments: true })).toEqual({ k: 1 })
  })

  it('parses plain JSON without stripComments', () => {
    expect(parseScriptContent('{"a":2}', 'script#x')).toEqual({ a: 2 })
  })

  it('extracts value at path', () => {
    expect(parseScriptContent('{"a":{"b":[1,2]}}', 'script#x', { path: 'a.b' })).toEqual([1, 2])
  })

  it('throws fatal error on invalid JSON', () => {
    expect(() => parseScriptContent('{bad}', 'script#x')).toThrow(/not valid JSON/)
  })
})

describe('parseScriptJson — HTML selector matching', () => {
  it('matches by id (script#id)', () => {
    const html = '<html><script id="a">{"ok":1}</script><script id="b">{"ok":2}</script></html>'
    expect(parseScriptJson(html, 'script#a')).toEqual({ ok: 1 })
    expect(parseScriptJson(html, 'script#b')).toEqual({ ok: 2 })
  })

  it('matches by attribute (script[type="application/ld+json"])', () => {
    const html = `<html>
<script type="application/json">{"x":1}</script>
<script type="application/ld+json">{"@type":"Thing"}</script>
</html>`
    expect(parseScriptJson(html, 'script[type="application/ld+json"]')).toEqual({ '@type': 'Thing' })
  })

  it('matches combined id + attr', () => {
    const html = '<html><script id="data" type="application/json">{"n":7}</script></html>'
    expect(parseScriptJson(html, 'script#data[type="application/json"]')).toEqual({ n: 7 })
  })

  it('throws when no tag matches', () => {
    const html = '<html><script id="a">{}</script></html>'
    expect(() => parseScriptJson(html, 'script#missing')).toThrow(/not found/)
  })

  it('rejects non-script selectors', () => {
    expect(() => parseScriptJson('<div>{}</div>', 'div#data')).toThrow(/must start with "script"/)
  })
})

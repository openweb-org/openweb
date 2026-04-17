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

describe('parseScriptJson — multi-match + type_filter', () => {
  const html = `<html>
<script type="application/ld+json">{"@type":"Hotel","name":"H1"}</script>
<script type="application/ld+json">{"@type":"BreadcrumbList","items":[]}</script>
<script type="application/ld+json">{"@type":"FAQPage","q":1}</script>
</html>`

  it('returns first block matching type_filter=Hotel', () => {
    expect(
      parseScriptJson(html, 'script[type="application/ld+json"]', { typeFilter: 'Hotel' }),
    ).toEqual({ '@type': 'Hotel', name: 'H1' })
  })

  it('handles @type as string[]', () => {
    const html2 = `<html>
<script type="application/ld+json">{"@type":["Thing","Hotel"],"name":"H2"}</script>
</html>`
    expect(
      parseScriptJson(html2, 'script[type="application/ld+json"]', { typeFilter: 'Hotel' }),
    ).toEqual({ '@type': ['Thing', 'Hotel'], name: 'H2' })
  })

  it('returns all blocks when multi=true', () => {
    const result = parseScriptJson(html, 'script[type="application/ld+json"]', { multi: true })
    expect(Array.isArray(result)).toBe(true)
    expect((result as unknown[]).length).toBe(3)
  })

  it('combines multi=true + type_filter', () => {
    const htmlTwoHotels = `<html>
<script type="application/ld+json">{"@type":"Hotel","name":"A"}</script>
<script type="application/ld+json">{"@type":"FAQPage"}</script>
<script type="application/ld+json">{"@type":"Hotel","name":"B"}</script>
</html>`
    const result = parseScriptJson(htmlTwoHotels, 'script[type="application/ld+json"]', {
      multi: true,
      typeFilter: 'Hotel',
    })
    expect(result).toEqual([
      { '@type': 'Hotel', name: 'A' },
      { '@type': 'Hotel', name: 'B' },
    ])
  })

  it('throws when type_filter matches nothing', () => {
    expect(() =>
      parseScriptJson(html, 'script[type="application/ld+json"]', { typeFilter: 'Movie' }),
    ).toThrow(/@type "Movie"/)
  })

  it('skips invalid JSON blocks when iterating', () => {
    const mixed = `<html>
<script type="application/ld+json">{not json}</script>
<script type="application/ld+json">{"@type":"Hotel","name":"OK"}</script>
</html>`
    expect(
      parseScriptJson(mixed, 'script[type="application/ld+json"]', { typeFilter: 'Hotel' }),
    ).toEqual({ '@type': 'Hotel', name: 'OK' })
  })
})

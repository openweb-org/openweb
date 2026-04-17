import { OpenWebError } from '../../lib/errors.js'
import { getValueAtPath } from '../value-path.js'

// Strip an outer HTML comment wrapper (<!-- ... -->) around JSON content.
// Seen on sites like Yelp where server-rendered JSON is commented out to
// neutralize accidental browser parsing.
const HTML_COMMENT = /^\s*<!--([\s\S]*?)-->\s*$/

function stripHtmlComment(raw: string): string {
  const m = HTML_COMMENT.exec(raw)
  return m ? m[1] : raw
}

// ── Minimal selector matcher ────────────────────────
// Supports selectors of the form:
//   script
//   script#id
//   script[attr="value"]
//   script#id[attr="value"][attr2="v2"]
// That covers the realistic shapes we emit (see analyzer/classify.ts).

interface ScriptSelector {
  readonly id?: string
  readonly attrs: ReadonlyArray<{ readonly name: string; readonly value: string }>
}

function parseSelector(selector: string): ScriptSelector {
  const trimmed = selector.trim()
  if (!trimmed.startsWith('script')) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Unsupported script_json selector "${selector}" — must start with "script".`,
      action: 'Use selectors like script#id or script[type="application/ld+json"].',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const rest = trimmed.slice('script'.length)
  let id: string | undefined
  const attrs: Array<{ name: string; value: string }> = []

  let i = 0
  while (i < rest.length) {
    const ch = rest[i]
    if (ch === '#') {
      const end = findSelectorSegmentEnd(rest, i + 1)
      id = rest.slice(i + 1, end)
      i = end
    } else if (ch === '[') {
      const end = rest.indexOf(']', i + 1)
      if (end < 0) throw selectorError(selector)
      const clause = rest.slice(i + 1, end)
      const match = /^([a-zA-Z_-][\w-]*)\s*=\s*"([^"]*)"$/.exec(clause) ?? /^([a-zA-Z_-][\w-]*)\s*=\s*'([^']*)'$/.exec(clause)
      if (!match) throw selectorError(selector)
      attrs.push({ name: match[1], value: match[2] })
      i = end + 1
    } else if (/\s/.test(ch)) {
      i += 1
    } else {
      throw selectorError(selector)
    }
  }

  return { id, attrs }
}

function findSelectorSegmentEnd(s: string, start: number): number {
  let i = start
  while (i < s.length && /[\w-]/.test(s[i])) i += 1
  return i
}

function selectorError(selector: string): OpenWebError {
  return new OpenWebError({
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
    message: `Unsupported script_json selector "${selector}".`,
    action: 'Use selectors like script#id or script[type="application/ld+json"].',
    retriable: false,
    failureClass: 'fatal',
  })
}

function getAttr(attrsStr: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
  const m = re.exec(attrsStr)
  return m ? (m[1] ?? m[2]) : undefined
}

function attrsMatch(attrsStr: string, sel: ScriptSelector): boolean {
  if (sel.id !== undefined && getAttr(attrsStr, 'id') !== sel.id) return false
  for (const { name, value } of sel.attrs) {
    if (getAttr(attrsStr, name) !== value) return false
  }
  return true
}

const SCRIPT_TAG_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi

function findScript(html: string, selector: string): string | undefined {
  const sel = parseSelector(selector)
  SCRIPT_TAG_RE.lastIndex = 0
  for (let m = SCRIPT_TAG_RE.exec(html); m; m = SCRIPT_TAG_RE.exec(html)) {
    const attrsStr = m[1] ?? ''
    if (attrsMatch(attrsStr, sel)) return m[2]
  }
  return undefined
}

// ── Public API ──────────────────────────────────────

/**
 * Parse JSON from a <script> element in HTML.
 *
 * Shared between the node extraction path (no browser) and the browser path
 * (which typically reads textContent directly but still needs strip_comments +
 * path handling).
 */
export function parseScriptJson(
  html: string,
  selector: string,
  options: { path?: string; stripComments?: boolean } = {},
): unknown {
  const raw = findScript(html, selector)
  if (raw === undefined) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Script element matching "${selector}" not found.`,
      action: 'Ensure the page is fully loaded and the selector targets an existing <script> tag.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  return parseScriptContent(raw, selector, options)
}

/**
 * Parse the textual content of a <script> tag (already located) into JSON,
 * optionally stripping an HTML-comment wrapper and/or extracting a sub-path.
 */
export function parseScriptContent(
  raw: string,
  selector: string,
  options: { path?: string; stripComments?: boolean } = {},
): unknown {
  const content = options.stripComments ? stripHtmlComment(raw) : raw

  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Script content is not valid JSON for selector "${selector}".`,
      action: options.stripComments
        ? 'Check the selector targets a JSON script tag (HTML comment wrapper was stripped).'
        : 'Check the selector targets a JSON script tag, or set strip_comments if wrapped in <!-- -->.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  if (!options.path) return data

  const value = getValueAtPath(data, options.path)
  if (value === undefined) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Path "${options.path}" not found in script JSON.`,
      action: 'Verify the JSON structure.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
  return value
}

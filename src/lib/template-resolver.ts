/**
 * Cross-op response templating for verify.
 *
 * Lets an example op's `input` reference values from an earlier op's response
 * via `${prev.<opId>.<dot.path[idx]>}`. See
 * doc/todo/write-verify/design/cross-op-templating.md.
 */

export type TemplateErrorKind = 'bad_syntax' | 'missing_dependency' | 'missing_path'

export class TemplateError extends Error {
  readonly kind: TemplateErrorKind
  readonly template: string

  constructor(kind: TemplateErrorKind, template: string, detail: string) {
    super(`template ${template}: ${detail}`)
    this.name = 'TemplateError'
    this.kind = kind
    this.template = template
  }
}

export interface ResponseStore {
  get(opId: string): unknown | undefined
  set(opId: string, body: unknown): void
}

export function createResponseStore(): ResponseStore {
  const map = new Map<string, unknown>()
  return {
    get: (id) => map.get(id),
    set: (id, body) => { map.set(id, body) },
  }
}

const PLACEHOLDER = /\$\{([^}]*)\}/g
const ESCAPED = /\$\$\{/g
const ESCAPE_SENTINEL = '\u0000ESC\u0000'

export function resolveTemplates(input: unknown, store: ResponseStore): unknown {
  if (typeof input === 'string') return resolveString(input, store)
  if (Array.isArray(input)) return input.map((v) => resolveTemplates(v, store))
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = resolveTemplates(v, store)
    }
    return out
  }
  return input
}

function resolveString(raw: string, store: ResponseStore): unknown {
  // Reject unclosed `${` once up front (regex below won't match it, so it'd
  // silently pass through).
  const escaped = raw.replace(ESCAPED, ESCAPE_SENTINEL)
  if (/\$\{(?![^}]*\})/.test(escaped)) {
    throw new TemplateError('bad_syntax', raw, 'unclosed placeholder')
  }

  // Whole-value mode: entire string is a single placeholder.
  const wholeMatch = /^\$\{([^}]+)\}$/.exec(escaped)
  if (wholeMatch) {
    return lookup(wholeMatch[1] ?? '', raw, store)
  }

  // Interpolation mode.
  const interpolated = escaped.replace(PLACEHOLDER, (_, expr: string) => {
    const v = lookup(expr, raw, store)
    return v == null ? '' : String(v)
  })

  return interpolated.replaceAll(ESCAPE_SENTINEL, '${')
}

function lookup(expr: string, template: string, store: ResponseStore): unknown {
  const trimmed = expr.trim()
  if (!trimmed) throw new TemplateError('bad_syntax', template, 'empty placeholder')

  // Built-in helpers (no namespace prefix). Useful for fixtures that need
  // unique values per run (e.g. `createTweet` text — Twitter rejects duplicates).
  if (trimmed === 'now') return Date.now()

  // Normalize foo[0].bar → foo.0.bar
  const normalized = trimmed.replace(/\[(\d+)\]/g, '.$1')
  const parts = normalized.split('.').filter((p) => p.length > 0)
  if (parts.length < 3 || parts[0] !== 'prev') {
    throw new TemplateError('bad_syntax', template, 'expected ${prev.<opId>.<path>} or ${now}')
  }

  const opId = parts[1] ?? ''
  const path = parts.slice(2)

  const body = store.get(opId)
  if (body === undefined) {
    throw new TemplateError(
      'missing_dependency',
      template,
      `op "${opId}" has not run yet (or didn't PASS)`,
    )
  }

  let cur: unknown = body
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') {
      throw new TemplateError('missing_path', template, `cannot descend "${seg}" — value is ${cur === null ? 'null' : typeof cur}`)
    }
    if (Array.isArray(cur)) {
      const idx = Number(seg)
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
        throw new TemplateError('missing_path', template, `array index "${seg}" out of bounds`)
      }
      cur = cur[idx]
    } else {
      const obj = cur as Record<string, unknown>
      if (!(seg in obj)) {
        throw new TemplateError('missing_path', template, `key "${seg}" not found`)
      }
      cur = obj[seg]
    }
  }
  return cur
}

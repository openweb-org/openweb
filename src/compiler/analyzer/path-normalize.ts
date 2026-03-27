import type { PathNormalization } from '../types-v2.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NUMERIC_RE = /^\d+$/
const HEX_RE = /^[0-9a-f]{9,}$/i
/** Base64-ish: long alphanumeric with mixed case or padding */
const BASE64_RE = /^[A-Za-z0-9+/=_-]{16,}$/

/** Minimum distinct values to "learn" a segment as a parameter in batch mode */
const MIN_LEARNED_CARDINALITY = 3

type SegmentKind = PathNormalization['normalizedSegments'][number]['kind']

interface NormalizedSegment {
  readonly index: number
  readonly kind: SegmentKind
}

type NormalizeResult = { template: string; normalization?: PathNormalization }

function classifySegment(segment: string): SegmentKind | null {
  // Very short segments (1-2 chars) are likely path prefixes, not IDs
  if (segment.length <= 2) return null
  if (/^urn:/.test(segment)) return 'urn'
  if (UUID_RE.test(segment)) return 'uuid'
  if (NUMERIC_RE.test(segment)) return 'numeric'
  if (HEX_RE.test(segment)) return 'hex'
  // Only treat base64-ish tokens as IDs (skip common words/names)
  if (BASE64_RE.test(segment) && /\d/.test(segment)) return 'hex'
  return null
}

export function normalizePath(path: string): NormalizeResult {
  const segments = path.split('/')
  const normalizedSegments: NormalizedSegment[] = []

  const templateSegments = segments.map((seg, i) => {
    const kind = classifySegment(seg)
    if (kind) {
      normalizedSegments.push({ index: i, kind })
      return '{id}'
    }
    return seg
  })

  if (normalizedSegments.length === 0) {
    return { template: path }
  }

  return {
    template: templateSegments.join('/'),
    normalization: {
      originalPaths: [path],
      normalizedSegments,
    },
  }
}

export function normalizePathBatch(
  paths: string[],
): Map<string, NormalizeResult> {
  const result = new Map<string, NormalizeResult>()

  // Phase 1: pattern-match each path individually
  const preNormalized = new Map<string, NormalizeResult>()
  for (const p of paths) {
    preNormalized.set(p, normalizePath(p))
  }

  // Phase 2: cross-sample inference — group by segment count
  const byLength = new Map<number, string[]>()
  for (const p of paths) {
    const segs = p.split('/')
    const list = byLength.get(segs.length)
    if (list) list.push(p)
    else byLength.set(segs.length, [p])
  }

  const learnedTemplates = new Map<string, { segmentIndex: number; originalPaths: string[] }>()

  for (const group of byLength.values()) {
    if (group.length < 2) continue

    const segArrays = group.map((p) => p.split('/'))
    const templateSegArrays = group.map((p) => {
      const pre = preNormalized.get(p)
      return pre ? pre.template.split('/') : p.split('/')
    })
    const segCount = segArrays[0].length

    for (let i = 0; i < segCount; i++) {
      const values = new Set(segArrays.map((s) => s[i]))
      if (values.size <= 1) continue
      // Require enough distinct values to be confident this is a parameter,
      // not just two different endpoints (e.g. /feed/ vs /jobs/)
      if (values.size < MIN_LEARNED_CARDINALITY) continue

      const allAlreadyNormalized = group.every((p) => {
        const n = preNormalized.get(p)
        return n?.normalization?.normalizedSegments.some((s) => s.index === i)
      })
      if (allAlreadyNormalized) continue

      // Only learn if exactly one segment varies (compare pre-normalized templates)
      const otherSegsSame = Array.from({ length: segCount }, (_, j) => j)
        .filter((j) => j !== i)
        .every((j) => {
          const ref = templateSegArrays[0][j]
          return templateSegArrays.every((s) => s[j] === ref)
        })

      if (!otherSegsSame) continue

      const templateSegs = [...segArrays[0]]
      templateSegs[i] = '{param}'
      learnedTemplates.set(templateSegs.join('/'), { segmentIndex: i, originalPaths: [...group] })
    }
  }

  // Phase 3: merge results
  const pathToLearned = new Map<string, string>()
  for (const [template, info] of learnedTemplates) {
    for (const p of info.originalPaths) {
      pathToLearned.set(p, template)
    }
  }

  for (const p of paths) {
    const pre = preNormalized.get(p) ?? { template: p }
    const learnedTemplate = pathToLearned.get(p)
    const info = learnedTemplate ? learnedTemplates.get(learnedTemplate) : undefined

    if (info && !pre.normalization) {
      result.set(p, {
        template: learnedTemplate as string,
        normalization: {
          originalPaths: info.originalPaths,
          normalizedSegments: [{ index: info.segmentIndex, kind: 'learned' }],
        },
      })
    } else if (info && pre.normalization) {
      const alreadyHasSegment = pre.normalization.normalizedSegments.some(
        (s) => s.index === info.segmentIndex,
      )
      if (alreadyHasSegment) {
        result.set(p, pre)
      } else {
        const templateSegs = pre.template.split('/')
        templateSegs[info.segmentIndex] = '{param}'
        result.set(p, {
          template: templateSegs.join('/'),
          normalization: {
            originalPaths: info.originalPaths,
            normalizedSegments: [
              ...pre.normalization.normalizedSegments,
              { index: info.segmentIndex, kind: 'learned' },
            ],
          },
        })
      }
    } else {
      result.set(p, pre)
    }
  }

  return result
}

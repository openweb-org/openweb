import type { WsDiscriminator, WsDiscriminatorConfig } from '../../types/ws-primitives.js'
import type { ParsedWsFrame, WsConnection } from './ws-load.js'

// ── Output types ──────────────────────────────────────────────

export interface WsMessageCluster {
  readonly discriminatorField?: string
  readonly discriminatorValue: string | number
  readonly subField?: string
  readonly subValue?: string | number
  readonly direction: 'sent' | 'received'
  readonly frames: ParsedWsFrame[]
  readonly count: number
}

export interface WsAnalysis {
  readonly connection: WsConnection
  readonly discriminator: WsDiscriminatorConfig
  readonly clusters: WsMessageCluster[]
}

// ── Constants ─────────────────────────────────────────────────

const COVERAGE_THRESHOLD = 0.8
const MAX_CARDINALITY = 30
const SUB_DISCRIMINATOR_THRESHOLD = 0.3

const PREFERRED_FIELDS = new Set([
  'op',
  'type',
  'action',
  'event',
  'method',
  'cmd',
  'kind',
  'msg_type',
  'command',
  'msg',
  't',
  'subtype',
])

// ── Field stats ───────────────────────────────────────────────

interface FieldStats {
  count: number
  values: Set<string | number>
  typeConsistent: boolean
  observedType: 'string' | 'number' | null
}

function collectFieldStats(frames: ParsedWsFrame[]): Map<string, FieldStats> {
  const stats = new Map<string, FieldStats>()

  for (const frame of frames) {
    for (const [key, value] of Object.entries(frame.payload)) {
      const vType = typeof value
      if (vType !== 'string' && vType !== 'number') continue

      let fs = stats.get(key)
      if (!fs) {
        fs = { count: 0, values: new Set(), typeConsistent: true, observedType: null }
        stats.set(key, fs)
      }

      fs.count++
      fs.values.add(value as string | number)

      if (fs.observedType === null) {
        fs.observedType = vType
      } else if (fs.observedType !== vType) {
        fs.typeConsistent = false
      }
    }
  }

  return stats
}

// ── Discriminator detection ───────────────────────────────────

function scoreCandidate(name: string, coverage: number, cardinality: number): number {
  let score = 0
  if (PREFERRED_FIELDS.has(name)) score += 3
  if (coverage === 1.0) score += 2
  if (cardinality <= 10) score += 1
  if (cardinality <= 3) score += 1
  score -= cardinality / 30
  return score
}

export function detectDiscriminator(frames: ParsedWsFrame[]): WsDiscriminator | null {
  if (frames.length === 0) return null

  const stats = collectFieldStats(frames)
  const total = frames.length

  // Filter candidates
  const candidates: Array<{ name: string; coverage: number; cardinality: number }> = []
  for (const [name, fs] of stats) {
    const coverage = fs.count / total
    const cardinality = fs.values.size
    if (coverage >= COVERAGE_THRESHOLD && cardinality <= MAX_CARDINALITY && cardinality > 1 && fs.typeConsistent) {
      candidates.push({ name, coverage, cardinality })
    }
  }

  if (candidates.length === 0) return null

  // Score and pick best
  let best = candidates[0]
  let bestScore = scoreCandidate(best.name, best.coverage, best.cardinality)

  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]
    const s = scoreCandidate(c.name, c.coverage, c.cardinality)
    if (s > bestScore) {
      best = c
      bestScore = s
    }
  }

  const primary: WsDiscriminator = { field: best.name }

  // Sub-discriminator: group by primary value, find largest group
  const groups = new Map<string | number, ParsedWsFrame[]>()
  for (const frame of frames) {
    const val = frame.payload[best.name]
    if (typeof val === 'string' || typeof val === 'number') {
      const group = groups.get(val)
      if (group) {
        group.push(frame)
      } else {
        groups.set(val, [frame])
      }
    }
  }

  let largestKey: string | number | undefined
  let largestGroup: ParsedWsFrame[] = []
  for (const [key, group] of groups) {
    if (group.length > largestGroup.length) {
      largestKey = key
      largestGroup = group
    }
  }

  if (largestGroup.length > total * SUB_DISCRIMINATOR_THRESHOLD) {
    const sub = detectDiscriminator(largestGroup)
    if (sub && sub.field !== best.name) {
      return { field: best.name, sub_field: sub.field, sub_field_on: largestKey }
    }
  }

  return primary
}

// ── Clustering ────────────────────────────────────────────────

function clusterFrames(
  frames: ParsedWsFrame[],
  direction: 'sent' | 'received',
  disc: WsDiscriminator | null,
): WsMessageCluster[] {
  const dirFrames = frames.filter((f) => f.direction === direction)
  if (dirFrames.length === 0) return []

  // No discriminator → single cluster
  if (!disc) {
    return [
      {
        discriminatorValue: '*',
        direction,
        frames: dirFrames,
        count: dirFrames.length,
      },
    ]
  }

  const groups = new Map<string | number, ParsedWsFrame[]>()
  for (const frame of dirFrames) {
    const val = frame.payload[disc.field]
    const key = typeof val === 'string' || typeof val === 'number' ? val : '__unknown__'
    const group = groups.get(key)
    if (group) {
      group.push(frame)
    } else {
      groups.set(key, [frame])
    }
  }

  const clusters: WsMessageCluster[] = []

  for (const [discValue, groupFrames] of groups) {
    if (disc.sub_field && discValue === disc.sub_field_on) {
      // Sub-cluster by sub_field
      const subGroups = new Map<string | number, ParsedWsFrame[]>()
      for (const frame of groupFrames) {
        const subVal = frame.payload[disc.sub_field]
        const subKey = typeof subVal === 'string' || typeof subVal === 'number' ? subVal : '__unknown__'
        const sg = subGroups.get(subKey)
        if (sg) {
          sg.push(frame)
        } else {
          subGroups.set(subKey, [frame])
        }
      }
      for (const [subValue, subFrames] of subGroups) {
        clusters.push({
          discriminatorField: disc.field,
          discriminatorValue: discValue,
          subField: disc.sub_field,
          subValue,
          direction,
          frames: subFrames,
          count: subFrames.length,
        })
      }
    } else {
      clusters.push({
        discriminatorField: disc.field,
        discriminatorValue: discValue,
        direction,
        frames: groupFrames,
        count: groupFrames.length,
      })
    }
  }

  return clusters
}

// ── Main entry ────────────────────────────────────────────────

export function analyzeWsConnection(connection: WsConnection): WsAnalysis {
  const sentFrames = connection.frames.filter((f) => f.direction === 'sent')
  const receivedFrames = connection.frames.filter((f) => f.direction === 'received')

  const sentDisc = detectDiscriminator(sentFrames)
  const receivedDisc = detectDiscriminator(receivedFrames)

  const discriminator: WsDiscriminatorConfig = {
    sent: sentDisc,
    received: receivedDisc,
  }

  const clusters = [
    ...clusterFrames(connection.frames, 'sent', sentDisc),
    ...clusterFrames(connection.frames, 'received', receivedDisc),
  ]

  return { connection, discriminator, clusters }
}

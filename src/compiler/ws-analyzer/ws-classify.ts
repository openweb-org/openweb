import type { WsPattern } from '../../types/ws-primitives.js'
import type { ParsedWsFrame } from './ws-load.js'
import type { WsMessageCluster } from './ws-cluster.js'

// ── Output types ──────────────────────────────────────────────

export interface ClassifiedCluster extends WsMessageCluster {
  readonly pattern: WsPattern
}

// ── Constants ─────────────────────────────────────────────────

/** Coefficient of variation threshold for periodic detection. */
const CV_THRESHOLD = 0.3

/** Minimum frames to consider periodicity. */
const MIN_PERIODIC_FRAMES = 3

/** ID-like field names for correlation detection. */
export const CORRELATION_FIELDS = new Set([
  'id',
  'request_id',
  'req_id',
  'requestId',
  'nonce',
  'seq',
  'sequence',
  'msg_id',
  'msgId',
  'correlation_id',
  'correlationId',
  'ref',
])

// ── Helpers ───────────────────────────────────────────────────

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return Infinity
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean === 0) return Infinity
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}

function interFrameIntervals(frames: ParsedWsFrame[]): number[] {
  if (frames.length < 2) return []
  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp)
  const intervals: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(sorted[i].timestamp - sorted[i - 1].timestamp)
  }
  return intervals
}

function isPeriodic(frames: ParsedWsFrame[]): boolean {
  if (frames.length < MIN_PERIODIC_FRAMES) return false
  const intervals = interFrameIntervals(frames)
  if (intervals.length === 0) return false
  return coefficientOfVariation(intervals) < CV_THRESHOLD
}

/** Count distinct key-set shapes in the cluster's payloads. */
function payloadShapeCount(frames: ParsedWsFrame[]): number {
  const shapes = new Set<string>()
  for (const f of frames) {
    shapes.add(Object.keys(f.payload).sort().join(','))
  }
  return shapes.size
}

/** Extract values for correlation-like fields from frames. */
function correlationValues(frames: ParsedWsFrame[]): Map<string, Set<string | number>> {
  const result = new Map<string, Set<string | number>>()
  for (const frame of frames) {
    for (const [key, val] of Object.entries(frame.payload)) {
      if (!CORRELATION_FIELDS.has(key)) continue
      if (typeof val !== 'string' && typeof val !== 'number') continue
      let s = result.get(key)
      if (!s) {
        s = new Set()
        result.set(key, s)
      }
      s.add(val)
    }
  }
  return result
}

// ── Classification ────────────────────────────────────────────

function isHeartbeat(cluster: WsMessageCluster): boolean {
  return isPeriodic(cluster.frames) && payloadShapeCount(cluster.frames) <= 2
}

function hasCorrelation(
  sentClusters: WsMessageCluster[],
  receivedClusters: WsMessageCluster[],
  cluster: WsMessageCluster,
): boolean {
  const opposite = cluster.direction === 'sent' ? receivedClusters : sentClusters
  const clusterCorr = correlationValues(cluster.frames)
  if (clusterCorr.size === 0) return false

  for (const other of opposite) {
    const otherCorr = correlationValues(other.frames)
    for (const [field, values] of clusterCorr) {
      const otherValues = otherCorr.get(field)
      if (!otherValues) continue
      // Check for at least one shared value
      for (const v of values) {
        if (otherValues.has(v)) return true
      }
    }
  }
  return false
}

function isSubscribeLike(
  sentClusters: WsMessageCluster[],
  receivedClusters: WsMessageCluster[],
  cluster: WsMessageCluster,
): boolean {
  if (cluster.direction !== 'sent') return false
  // Few sent frames + at least one received cluster with significantly more frames
  if (cluster.count > 5) return false
  for (const recv of receivedClusters) {
    if (recv.count >= cluster.count * 3) return true
  }
  return false
}

// ── Main entry ────────────────────────────────────────────────

export function classifyClusters(clusters: WsMessageCluster[]): ClassifiedCluster[] {
  const sentClusters = clusters.filter((c) => c.direction === 'sent')
  const receivedClusters = clusters.filter((c) => c.direction === 'received')

  // Track which clusters are classified as heartbeat to pair acks
  const heartbeatIndices = new Set<number>()

  // Pass 1: detect heartbeats
  for (let i = 0; i < clusters.length; i++) {
    if (isHeartbeat(clusters[i])) {
      heartbeatIndices.add(i)
    }
  }

  // If we have a sent heartbeat, try to find its ack among received clusters
  for (const i of heartbeatIndices) {
    if (clusters[i].direction !== 'sent') continue
    for (let j = 0; j < clusters.length; j++) {
      if (j === i || heartbeatIndices.has(j)) continue
      if (clusters[j].direction !== 'received') continue
      // Ack: count within ±50% of sent heartbeat count
      const ratio = clusters[j].count / clusters[i].count
      if (ratio >= 0.5 && ratio <= 1.5 && isPeriodic(clusters[j].frames)) {
        heartbeatIndices.add(j)
      }
    }
  }

  // Pass 2: classify remaining
  const result: ClassifiedCluster[] = []

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i]

    if (heartbeatIndices.has(i)) {
      result.push({ ...cluster, pattern: 'heartbeat' })
      continue
    }

    // Direction-only patterns
    if (cluster.direction === 'received' && !hasCorrelation(sentClusters, receivedClusters, cluster)) {
      result.push({ ...cluster, pattern: 'stream' })
      continue
    }

    if (cluster.direction === 'sent') {
      if (hasCorrelation(sentClusters, receivedClusters, cluster)) {
        result.push({ ...cluster, pattern: 'request_reply' })
        continue
      }
      if (isSubscribeLike(sentClusters, receivedClusters, cluster)) {
        result.push({ ...cluster, pattern: 'subscribe' })
        continue
      }
      result.push({ ...cluster, pattern: 'publish' })
      continue
    }

    // Received with correlation → request_reply
    result.push({ ...cluster, pattern: 'request_reply' })
  }

  return result
}

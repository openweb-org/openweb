import type { WsDiscriminatorConfig } from '../types/ws-primitives.js'
import { getValueAtPath } from './value-path.js'

// ── Frame Categories ──────────────────────────────

export type FrameCategory = 'control' | 'ack' | 'event' | 'response' | 'unknown'

export interface ClassifiedFrame {
  readonly category: FrameCategory
  readonly operationId?: string
  readonly payload: unknown
}

// ── Router Config ─────────────────────────────────

export interface ControlPattern {
  /** Discriminator values that identify this control frame (e.g., { op: 10 } for hello) */
  readonly match: Record<string, unknown>
}

export interface AckPattern {
  /** Discriminator values that identify an ack (e.g., { op: 11 } for heartbeat ack) */
  readonly match: Record<string, unknown>
}

export interface ResponsePattern {
  /** Field path containing correlation ID */
  readonly correlationField: string
}

export interface EventRoute {
  readonly operationId: string
  /** Discriminator values for this event type */
  readonly match: Record<string, unknown>
}

export interface WsRouterConfig {
  readonly discriminator: WsDiscriminatorConfig
  readonly controlPatterns: readonly ControlPattern[]
  readonly ackPatterns: readonly AckPattern[]
  readonly responsePattern?: ResponsePattern
  readonly eventRoutes: readonly EventRoute[]
}

// ── Router ────────────────────────────────────────

export class WsRouter {
  private readonly config: WsRouterConfig

  constructor(config: WsRouterConfig) {
    this.config = config
  }

  classify(payload: unknown): ClassifiedFrame {
    if (!payload || typeof payload !== 'object') {
      return { category: 'unknown', payload }
    }

    const disc = this.config.discriminator.received
    if (!disc) {
      return { category: 'unknown', payload }
    }

    // Check control patterns
    for (const pattern of this.config.controlPatterns) {
      if (matchesPattern(payload, pattern.match, disc.field)) {
        return { category: 'control', payload }
      }
    }

    // Check ack patterns
    for (const pattern of this.config.ackPatterns) {
      if (matchesPattern(payload, pattern.match, disc.field)) {
        return { category: 'ack', payload }
      }
    }

    // Check response (correlation-based)
    if (this.config.responsePattern) {
      const corrValue = getValueAtPath(payload, this.config.responsePattern.correlationField)
      if (corrValue !== undefined) {
        return { category: 'response', payload }
      }
    }

    // Check event routes
    for (const route of this.config.eventRoutes) {
      if (matchesAllFields(payload, route.match)) {
        return { category: 'event', operationId: route.operationId, payload }
      }
    }

    return { category: 'unknown', payload }
  }
}

// ── Matching Helpers ──────────────────────────────

function matchesPattern(
  payload: unknown,
  match: Record<string, unknown>,
  discriminatorField: string,
): boolean {
  // Quick check: the discriminator field must match
  const discValue = getValueAtPath(payload, discriminatorField)
  const matchDiscValue = match[discriminatorField]
  if (matchDiscValue !== undefined && discValue !== matchDiscValue) return false
  return matchesAllFields(payload, match)
}

function matchesAllFields(payload: unknown, match: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(match)) {
    const actual = getValueAtPath(payload, key)
    if (actual !== expected) return false
  }
  return true
}

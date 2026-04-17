import { OpenWebError } from '../lib/errors.js'
import type { OpenApiOperation, OpenApiSpec } from '../lib/spec-loader.js'
import type { AdapterRef, PagePlanConfig, XOpenWebServer } from '../types/extensions.js'
import type { Transport } from '../types/extensions.js'

const VALID_TRANSPORTS = new Set<string>(['node', 'page'])

/** Read x-openweb config from the server entry matching this operation,
 *  then merge operation-level overrides (auth, csrf, signing can be
 *  set or disabled per-operation via `x-openweb` on the operation). */
export function getServerXOpenWeb(spec: OpenApiSpec, operation: OpenApiOperation): XOpenWebServer | undefined {
  const serverUrl = operation.servers?.[0]?.url ?? spec.servers?.[0]?.url
  if (!serverUrl) return undefined

  let serverExt: XOpenWebServer | undefined

  // Check operation-level servers first (operation overrides spec)
  for (const server of operation.servers ?? []) {
    if (server.url === serverUrl) {
      serverExt = (server as Record<string, unknown>)['x-openweb'] as XOpenWebServer | undefined
      break
    }
  }

  if (!serverExt) {
    for (const server of spec.servers ?? []) {
      if (server.url === serverUrl) {
        serverExt = (server as Record<string, unknown>)['x-openweb'] as XOpenWebServer | undefined
        break
      }
    }
  }

  if (!serverExt) return undefined

  // Merge operation-level x-openweb overrides (auth, csrf, signing)
  // Setting `auth: false` at op level disables auth for that op.
  const opExt = operation['x-openweb'] as Record<string, unknown> | undefined
  if (!opExt) return serverExt

  const merged = { ...serverExt }
  if ('auth' in opExt) (merged as Record<string, unknown>).auth = opExt.auth || undefined
  if ('csrf' in opExt) (merged as Record<string, unknown>).csrf = opExt.csrf || undefined
  if ('signing' in opExt) (merged as Record<string, unknown>).signing = opExt.signing || undefined
  if ('adapter' in opExt) (merged as Record<string, unknown>).adapter = opExt.adapter || undefined
  return merged as XOpenWebServer
}

/** Determine transport: operation-level overrides server-level, default node */
export function resolveTransport(spec: OpenApiSpec, operation: OpenApiOperation): Transport {
  const opExt = operation['x-openweb'] as Record<string, unknown> | undefined
  if (opExt?.transport) {
    const t = opExt.transport as string
    if (!VALID_TRANSPORTS.has(t)) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Unknown transport: ${t}`,
        action: 'Valid transports: node, page.',
        retriable: false,
        failureClass: 'fatal',
      })
    }
    return t as Transport
  }

  const serverExt = getServerXOpenWeb(spec, operation)
  const serverTransport = serverExt?.transport ?? 'node'
  if (!VALID_TRANSPORTS.has(serverTransport)) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Unknown transport: ${serverTransport}`,
      action: 'Valid transports: node, page.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
  return serverTransport as Transport
}

const PAGE_PLAN_FIELDS = [
  'entry_url',
  'ready',
  'wait_until',
  'settle_ms',
  'warm',
  'nav_timeout_ms',
] as const

/**
 * Merge server-level and operation-level page_plan configs.
 *
 * Each field is merged independently: operation fields override server fields,
 * and an explicitly-set falsy value on the operation (e.g. `warm: false`) still
 * wins over a server-level truthy value.
 */
export function resolvePagePlan(spec: OpenApiSpec, operation: OpenApiOperation): PagePlanConfig | undefined {
  const serverExt = getServerXOpenWeb(spec, operation)
  const serverPlan = serverExt?.page_plan
  const opExt = operation['x-openweb'] as { page_plan?: PagePlanConfig } | undefined
  const opPlan = opExt?.page_plan

  if (!serverPlan && !opPlan) return undefined

  const merged: Record<string, unknown> = { ...(serverPlan ?? {}) }
  if (opPlan) {
    const src = opPlan as Record<string, unknown>
    for (const field of PAGE_PLAN_FIELDS) {
      if (field in src) merged[field] = src[field]
    }
  }
  return merged as PagePlanConfig
}

/**
 * Resolve the adapter reference for an operation.
 *
 * Precedence: op-level `x-openweb.adapter` wins over server-level
 * `x-openweb.adapter`. Op-level `adapter: false` is an explicit opt-out — it
 * clears any server-level adapter for that operation. When op-level is an
 * AdapterRef, server-level `operation` / `params` serve as fallback defaults
 * for fields the op didn't set.
 */
export function resolveAdapterRef(spec: OpenApiSpec, operation: OpenApiOperation): AdapterRef | undefined {
  const opExt = operation['x-openweb'] as { adapter?: AdapterRef | false } | undefined
  if (opExt && 'adapter' in opExt && opExt.adapter === false) return undefined

  // Read raw server-level adapter (bypasses getServerXOpenWeb's merge, which
  // would otherwise fold op-level adapter into the server view).
  const serverUrl = operation.servers?.[0]?.url ?? spec.servers?.[0]?.url
  let rawServerExt: XOpenWebServer | undefined
  if (serverUrl) {
    const searchLists = [operation.servers, spec.servers]
    for (const list of searchLists) {
      if (rawServerExt) break
      for (const server of list ?? []) {
        if (server.url === serverUrl) {
          rawServerExt = (server as Record<string, unknown>)['x-openweb'] as XOpenWebServer | undefined
          break
        }
      }
    }
  }
  const serverAdapter = rawServerExt?.adapter
  const opAdapter = opExt?.adapter as AdapterRef | undefined

  if (!serverAdapter && !opAdapter) return undefined
  if (!opAdapter) return serverAdapter
  if (!serverAdapter) return opAdapter
  return {
    name: opAdapter.name ?? serverAdapter.name,
    operation: opAdapter.operation ?? serverAdapter.operation,
    params: opAdapter.params ?? serverAdapter.params,
  }
}

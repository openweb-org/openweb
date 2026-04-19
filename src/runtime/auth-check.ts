import { OpenWebError } from '../lib/errors.js'
import type { OpenApiOperation, OpenApiSpec } from '../lib/spec-loader.js'
import type { AuthCheckPrimitive, AuthCheckRule } from '../types/primitives.js'

import { getValueAtPath } from './value-path.js'

/** Resolve effective auth_check rules for an operation: server-level rules,
 *  with op-level overriding (op-level `false` disables entirely, op-level
 *  array replaces server-level). */
function resolveRules(spec: OpenApiSpec, operation: OpenApiOperation): AuthCheckPrimitive | undefined {
  const opExt = (operation as { 'x-openweb'?: Record<string, unknown> })['x-openweb']
  if (opExt && 'auth_check' in opExt) {
    const opRules = opExt.auth_check
    if (opRules === false) return undefined
    if (Array.isArray(opRules)) return opRules as AuthCheckPrimitive
  }

  const serverUrl = operation.servers?.[0]?.url ?? spec.servers?.[0]?.url
  if (!serverUrl) return undefined
  for (const list of [operation.servers, spec.servers]) {
    for (const server of list ?? []) {
      if (server.url !== serverUrl) continue
      const ext = (server as Record<string, unknown>)['x-openweb'] as { auth_check?: AuthCheckPrimitive } | undefined
      if (ext?.auth_check && Array.isArray(ext.auth_check)) return ext.auth_check
    }
  }
  return undefined
}

function ruleMatches(rule: AuthCheckRule, body: unknown): boolean {
  const target = rule.path ? getValueAtPath(body, rule.path) : body
  if (target === undefined || target === null) return false

  if (rule.equals !== undefined) {
    return String(target) === String(rule.equals)
  }
  if (rule.contains !== undefined) {
    const haystack = typeof target === 'string' ? target : JSON.stringify(target)
    return haystack.toLowerCase().includes(rule.contains.toLowerCase())
  }
  return false
}

/** Apply per-site auth_check rules to a parsed response body. Throws
 *  `OpenWebError.needsLogin()` when any rule matches, so the existing auth
 *  cascade in http-executor can recover (browser restart / interactive login). */
export function applyAuthCheck(body: unknown, spec: OpenApiSpec, operation: OpenApiOperation): void {
  const rules = resolveRules(spec, operation)
  if (!rules || rules.length === 0) return
  for (const rule of rules) {
    if (ruleMatches(rule, body)) {
      throw OpenWebError.needsLogin()
    }
  }
}

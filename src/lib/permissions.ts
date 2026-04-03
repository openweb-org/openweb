import type { PermissionCategory } from '../types/extensions.js'
import { loadConfig } from './config.js'

export type Policy = 'allow' | 'prompt' | 'deny'

export interface PermissionsConfig {
  readonly defaults: Record<PermissionCategory, Policy>
  readonly sites?: Record<string, Partial<Record<PermissionCategory, Policy>>>
}

const DEFAULT_PERMISSIONS: PermissionsConfig = {
  defaults: {
    read: 'allow',
    write: 'prompt',
    delete: 'prompt',
    transact: 'deny',
  },
}

const VALID_CATEGORIES = new Set<string>(['read', 'write', 'delete', 'transact'])
const VALID_POLICIES = new Set<string>(['allow', 'prompt', 'deny'])

function isValidPolicy(value: unknown): value is Policy {
  return typeof value === 'string' && VALID_POLICIES.has(value)
}

/** Parse and merge a partial config with defaults. Accepts configs with only `sites:` or only `defaults:`. */
function parseConfig(raw: unknown): PermissionsConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  // Parse defaults (optional — merge with built-in defaults)
  const defaults = { ...DEFAULT_PERMISSIONS.defaults }
  if (obj.defaults && typeof obj.defaults === 'object') {
    for (const [key, value] of Object.entries(obj.defaults as Record<string, unknown>)) {
      if (VALID_CATEGORIES.has(key) && isValidPolicy(value)) {
        defaults[key as PermissionCategory] = value
      }
    }
  }

  // Parse sites (optional)
  let sites: Record<string, Partial<Record<PermissionCategory, Policy>>> | undefined
  if (obj.sites && typeof obj.sites === 'object') {
    sites = {}
    for (const [siteName, siteOverrides] of Object.entries(obj.sites as Record<string, unknown>)) {
      if (!siteOverrides || typeof siteOverrides !== 'object') continue
      const overrides: Partial<Record<PermissionCategory, Policy>> = {}
      for (const [key, value] of Object.entries(siteOverrides as Record<string, unknown>)) {
        if (VALID_CATEGORIES.has(key) && isValidPolicy(value)) {
          overrides[key as PermissionCategory] = value
        }
      }
      if (Object.keys(overrides).length > 0) {
        sites[siteName] = overrides
      }
    }
  }

  return { defaults, sites }
}

export function loadPermissions(): PermissionsConfig {
  const config = loadConfig()
  if (!config.permissions) return DEFAULT_PERMISSIONS
  return parseConfig(config.permissions) ?? DEFAULT_PERMISSIONS
}

export function checkPermission(
  config: PermissionsConfig,
  site: string,
  category: PermissionCategory,
): Policy {
  // Site-specific override takes precedence
  const sitePolicy = config.sites?.[site]?.[category]
  if (sitePolicy) return sitePolicy

  return config.defaults[category] ?? 'prompt'
}

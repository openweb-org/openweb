import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import { parse } from 'yaml'

import type { PermissionCategory } from '../types/extensions.js'

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

function isValidConfig(raw: unknown): raw is PermissionsConfig {
  if (!raw || typeof raw !== 'object') return false
  const obj = raw as Record<string, unknown>
  if (!obj.defaults || typeof obj.defaults !== 'object') return false

  for (const [key, value] of Object.entries(obj.defaults as Record<string, unknown>)) {
    if (!VALID_CATEGORIES.has(key) || !VALID_POLICIES.has(value as string)) return false
  }

  if (obj.sites && typeof obj.sites === 'object') {
    for (const siteOverrides of Object.values(obj.sites as Record<string, unknown>)) {
      if (!siteOverrides || typeof siteOverrides !== 'object') return false
      for (const [key, value] of Object.entries(siteOverrides as Record<string, unknown>)) {
        if (!VALID_CATEGORIES.has(key) || !VALID_POLICIES.has(value as string)) return false
      }
    }
  }

  return true
}

export function loadPermissions(configPath?: string): PermissionsConfig {
  const filePath = configPath ?? join(homedir(), '.openweb', 'permissions.yaml')
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = parse(raw) as unknown
    if (isValidConfig(parsed)) {
      // Merge with defaults to ensure all categories exist
      return {
        defaults: { ...DEFAULT_PERMISSIONS.defaults, ...parsed.defaults },
        sites: parsed.sites,
      }
    }
  } catch {
    // File missing or unreadable — use defaults
  }
  return DEFAULT_PERMISSIONS
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

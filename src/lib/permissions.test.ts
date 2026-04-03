import { type MockInstance, afterEach, describe, expect, it, vi } from 'vitest'

import type { OpenWebConfig } from './config.js'
import * as configModule from './config.js'
import { type PermissionsConfig, checkPermission, loadPermissions } from './permissions.js'

describe('loadPermissions', () => {
  let spy: MockInstance<() => OpenWebConfig>

  afterEach(() => {
    spy?.mockRestore()
  })

  it('returns defaults when config has no permissions', () => {
    spy = vi.spyOn(configModule, 'loadConfig').mockReturnValue({})
    const config = loadPermissions()
    expect(config.defaults.read).toBe('allow')
    expect(config.defaults.write).toBe('prompt')
    expect(config.defaults.delete).toBe('prompt')
    expect(config.defaults.transact).toBe('deny')
  })

  it('loads valid permissions from config', () => {
    spy = vi.spyOn(configModule, 'loadConfig').mockReturnValue({
      permissions: {
        defaults: { read: 'allow', write: 'allow', delete: 'prompt', transact: 'deny' },
        sites: { instagram: { write: 'deny' } },
      },
    })
    const config = loadPermissions()
    expect(config.defaults.write).toBe('allow')
    expect(config.sites?.instagram?.write).toBe('deny')
  })

  it('falls back to defaults on invalid permissions structure', () => {
    spy = vi.spyOn(configModule, 'loadConfig').mockReturnValue({
      permissions: 'not-an-object' as unknown as OpenWebConfig['permissions'],
    })
    const config = loadPermissions()
    expect(config.defaults.read).toBe('allow')
  })

  it('accepts config with only sites (no defaults key)', () => {
    spy = vi.spyOn(configModule, 'loadConfig').mockReturnValue({
      permissions: {
        sites: { bank: { read: 'deny', write: 'deny' } },
      },
    })
    const config = loadPermissions()
    // Should merge with built-in defaults
    expect(config.defaults.read).toBe('allow')
    expect(config.defaults.write).toBe('prompt')
    expect(config.sites?.bank?.read).toBe('deny')
    expect(config.sites?.bank?.write).toBe('deny')
  })

  it('ignores invalid policy values in defaults', () => {
    spy = vi.spyOn(configModule, 'loadConfig').mockReturnValue({
      permissions: {
        defaults: {
          read: 'invalid_policy' as 'allow',
          write: 'allow',
          delete: 'prompt',
          transact: 'deny',
        },
      },
    })
    const config = loadPermissions()
    // invalid_policy ignored → falls back to built-in default for read
    expect(config.defaults.read).toBe('allow')
    expect(config.defaults.write).toBe('allow')
  })
})

describe('checkPermission', () => {
  const config: PermissionsConfig = {
    defaults: {
      read: 'allow',
      write: 'prompt',
      delete: 'prompt',
      transact: 'deny',
    },
    sites: {
      'bank': {
        read: 'prompt',
        write: 'deny',
      },
    },
  }

  it('returns default policy for unknown site', () => {
    expect(checkPermission(config, 'random-site', 'read')).toBe('allow')
    expect(checkPermission(config, 'random-site', 'write')).toBe('prompt')
    expect(checkPermission(config, 'random-site', 'transact')).toBe('deny')
  })

  it('returns site-specific override when present', () => {
    expect(checkPermission(config, 'bank', 'read')).toBe('prompt')
    expect(checkPermission(config, 'bank', 'write')).toBe('deny')
  })

  it('falls back to default when site has no override for category', () => {
    expect(checkPermission(config, 'bank', 'transact')).toBe('deny')
  })
})

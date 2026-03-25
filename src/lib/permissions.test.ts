import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it, afterEach } from 'vitest'

import { loadPermissions, checkPermission, type PermissionsConfig } from './permissions.js'

describe('loadPermissions', () => {
  const dirs: string[] = []

  function tmpConfig(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'openweb-perm-test-'))
    dirs.push(dir)
    const filePath = join(dir, 'permissions.yaml')
    writeFileSync(filePath, content, 'utf8')
    return filePath
  }

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  it('returns defaults when file does not exist', () => {
    const config = loadPermissions('/nonexistent/path/permissions.yaml')
    expect(config.defaults.read).toBe('allow')
    expect(config.defaults.write).toBe('prompt')
    expect(config.defaults.delete).toBe('prompt')
    expect(config.defaults.transact).toBe('deny')
  })

  it('loads valid config from file', () => {
    const path = tmpConfig(`
defaults:
  read: allow
  write: allow
  delete: prompt
  transact: deny
sites:
  instagram:
    write: deny
`)
    const config = loadPermissions(path)
    expect(config.defaults.write).toBe('allow')
    expect(config.sites?.['instagram']?.write).toBe('deny')
  })

  it('falls back to defaults on invalid config', () => {
    const path = tmpConfig('invalid: yaml: config')
    const config = loadPermissions(path)
    expect(config.defaults.read).toBe('allow')
  })

  it('accepts config with only sites (no defaults key)', () => {
    const path = tmpConfig(`
sites:
  bank:
    read: deny
    write: deny
`)
    const config = loadPermissions(path)
    // Should merge with built-in defaults
    expect(config.defaults.read).toBe('allow')
    expect(config.defaults.write).toBe('prompt')
    expect(config.sites?.['bank']?.read).toBe('deny')
    expect(config.sites?.['bank']?.write).toBe('deny')
  })

  it('ignores invalid policy values in defaults', () => {
    const path = tmpConfig(`
defaults:
  read: invalid_policy
  write: allow
  delete: prompt
  transact: deny
`)
    const config = loadPermissions(path)
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

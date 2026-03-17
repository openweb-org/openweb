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
  instagram-fixture:
    write: deny
`)
    const config = loadPermissions(path)
    expect(config.defaults.write).toBe('allow')
    expect(config.sites?.['instagram-fixture']?.write).toBe('deny')
  })

  it('falls back to defaults on invalid config', () => {
    const path = tmpConfig('invalid: yaml: config')
    const config = loadPermissions(path)
    expect(config.defaults.read).toBe('allow')
  })

  it('merges partial defaults with built-in defaults', () => {
    const path = tmpConfig(`
defaults:
  read: prompt
  write: allow
  delete: allow
  transact: prompt
`)
    const config = loadPermissions(path)
    expect(config.defaults.read).toBe('prompt')
    expect(config.defaults.transact).toBe('prompt')
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
      'bank-fixture': {
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
    expect(checkPermission(config, 'bank-fixture', 'read')).toBe('prompt')
    expect(checkPermission(config, 'bank-fixture', 'write')).toBe('deny')
  })

  it('falls back to default when site has no override for category', () => {
    expect(checkPermission(config, 'bank-fixture', 'transact')).toBe('deny')
  })
})

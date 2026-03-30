import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { renderOperation, renderSite, renderSiteJson, safeReadNotes } from './navigator.js'

describe('navigator', () => {
  it('renders site with readiness metadata', async () => {
    const output = await renderSite('open-meteo')
    expect(output).toContain('4 operations')
    expect(output).toContain('Transport:        node')
    expect(output).toContain('Requires browser: no')
    expect(output).toContain('Requires login:   no')
    expect(output).toContain('Permissions:')
    expect(output).toContain('read:')
    expect(output).toContain('Operations:')
    expect(output).toContain('get_forecast')
    expect(output).toContain('search_location')
  })

  it('renders site with auth requirements', async () => {
    const output = await renderSite('instagram')
    expect(output).toContain('Instagram')
    expect(output).toContain('Transport:        page')
    expect(output).toContain('Requires browser: yes')
    expect(output).toContain('Requires login:   yes')
  })

  it('renders one operation with resolved transport', async () => {
    const output = await renderOperation('open-meteo', 'get_forecast', false)
    expect(output).toContain('GET /v1/forecast')
    expect(output).toContain('Transport: node')
    expect(output).toContain('Permission: read')
  })

  it('renders request body fields for JSON operations', async () => {
    const output = await renderOperation('youtube', 'getVideoDetail', false)

    expect(output).toContain('Body:')
    expect(output).toMatch(/videoId.*\[required\]/)
  })

  it('summarizes array responses with item fields', async () => {
    const output = await renderOperation('hackernews', 'getTopStories', false)

    expect(output).toContain('Returns: array<{ title, score, author, age }>')
  })

  it('renders L3 adapter transport for adapter-backed sites and operations', async () => {
    const siteOutput = await renderSite('telegram')
    const opOutput = await renderOperation('telegram', 'getDialogs', false)

    expect(siteOutput).toContain('Transport:        adapter (L3)')
    expect(opOutput).toContain('Transport: adapter (L3)')
  })

  it('shows notes hint when DOC.md exists', async () => {
    // Create a temp fixture with DOC.md to test independently of ~/.openweb state
    const result = await safeReadNotes(path.join(process.cwd(), 'src/sites/bestbuy'))
    expect(result).toBeTruthy()
    expect(result).toContain('Best Buy')
  })

  it('returns null when no DOC.md exists', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'no-doc-'))
    try {
      const result = await safeReadNotes(tmpDir)
      expect(result).toBeNull()
    } finally {
      await rm(tmpDir, { recursive: true })
    }
  })

  it('rejects symlinked DOC.md', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'doc-test-'))
    try {
      await symlink('/etc/hosts', path.join(tmpDir, 'DOC.md'))
      const result = await safeReadNotes(tmpDir)
      expect(result).toBeNull()
    } finally {
      await rm(tmpDir, { recursive: true })
    }
  })

  it('includes hasNotes boolean in JSON output', async () => {
    const output = await renderSiteJson('open-meteo')
    const parsed = JSON.parse(output)
    expect(typeof parsed.hasNotes).toBe('boolean')
  })

  it('throws non-ENOENT errors from safeReadNotes', async () => {
    // Pass a file (not a directory) as siteRoot — lstat on siteRoot/DOC.md
    // will fail with ENOTDIR, which is not ENOENT and should propagate
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'notes-err-'))
    const filePath = path.join(tmpDir, 'not-a-dir')
    try {
      await writeFile(filePath, 'data')
      await expect(safeReadNotes(filePath)).rejects.toThrow()
    } finally {
      await rm(tmpDir, { recursive: true })
    }
  })
})

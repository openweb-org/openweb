import { describe, expect, it } from 'vitest'

import { renderOperation, renderSite, renderSiteJson } from './navigator.js'

describe('navigator', () => {
  it('renders site with readiness metadata', async () => {
    const output = await renderSite('open-meteo-fixture')
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
    const output = await renderSite('instagram-fixture')
    expect(output).toContain('Instagram')
    expect(output).toContain('Transport:        node')
    expect(output).toContain('Requires browser: yes')
    expect(output).toContain('Requires login:   yes')
  })

  it('renders one operation with resolved transport', async () => {
    const output = await renderOperation('open-meteo-fixture', 'get_forecast', false)
    expect(output).toContain('GET /v1/forecast')
    expect(output).toContain('Transport: node')
    expect(output).toContain('Permission: read')
  })

  it('renders request body fields for JSON operations', async () => {
    const output = await renderOperation('youtube-fixture', 'getVideoInfo', false)

    expect(output).toContain('Body:')
    expect(output).toMatch(/videoId.*\[required\]/)
  })

  it('summarizes array responses with item fields', async () => {
    const output = await renderOperation('hackernews-fixture', 'getTopStories', false)

    expect(output).toContain('Returns: array<{ title, score, author }>')
  })

  it('renders L3 adapter transport for adapter-backed sites and operations', async () => {
    const siteOutput = await renderSite('telegram-fixture')
    const opOutput = await renderOperation('telegram-fixture', 'getDialogs', false)

    expect(siteOutput).toContain('Transport:        adapter (L3)')
    expect(opOutput).toContain('Transport: adapter (L3)')
  })

  it('shows notes hint when notes.md exists', async () => {
    const output = await renderSite('instagram-fixture')
    expect(output).toContain('Notes:')
    expect(output).toContain('Cookie expiry fast')
  })

  it('omits notes hint when no notes.md', async () => {
    const output = await renderSite('open-meteo-fixture')
    expect(output).not.toContain('Notes:')
  })

  it('includes hasNotes in JSON output', async () => {
    const withNotes = JSON.parse(await renderSiteJson('instagram-fixture'))
    const withoutNotes = JSON.parse(await renderSiteJson('open-meteo-fixture'))

    expect(withNotes.hasNotes).toBe(true)
    expect(withoutNotes.hasNotes).toBe(false)
  })
})

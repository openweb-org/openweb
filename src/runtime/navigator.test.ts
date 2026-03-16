import { describe, expect, it } from 'vitest'

import { renderOperation, renderSite } from './navigator.js'

describe('navigator', () => {
  it('renders site with readiness metadata', async () => {
    const output = await renderSite('open-meteo-fixture')
    expect(output).toContain('4 operations')
    expect(output).toContain('Mode:             direct_http')
    expect(output).toContain('Requires browser: no')
    expect(output).toContain('Requires login:   no')
    expect(output).toContain('Risk summary:')
    expect(output).toContain('safe:')
    expect(output).toContain('Operations:')
    expect(output).toContain('get_forecast')
    expect(output).toContain('search_location')
  })

  it('renders site with auth requirements', async () => {
    const output = await renderSite('instagram-fixture')
    expect(output).toContain('Instagram')
    expect(output).toContain('Mode:             session_http')
    expect(output).toContain('Requires browser: yes')
    expect(output).toContain('Requires login:   yes')
  })

  it('renders one operation with resolved mode', async () => {
    const output = await renderOperation('open-meteo-fixture', 'get_forecast', false)
    expect(output).toContain('GET /v1/forecast')
    expect(output).toContain('Mode: direct_http')
    expect(output).toContain('Risk: safe')
  })
})

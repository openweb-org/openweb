import { describe, expect, it } from 'vitest'

import { renderOperation, renderSite } from './navigator.js'

describe('navigator', () => {
  it('renders site tool list', async () => {
    const output = await renderSite('open-meteo-fixture')
    expect(output).toContain('get_forecast')
    expect(output).toContain('search_location')
  })

  it('renders one operation summary', async () => {
    const output = await renderOperation('open-meteo-fixture', 'get_forecast', false)
    expect(output).toContain('GET /v1/forecast')
    expect(output).toContain('Mode: direct_http')
  })
})

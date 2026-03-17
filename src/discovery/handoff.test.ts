import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright'

import { detectHandoffNeeded } from './handoff.js'

function mockPage(evaluateResult: unknown, url = 'https://example.com/login'): Page {
  return {
    url: vi.fn(() => url),
    evaluate: vi.fn(async () => evaluateResult),
  } as unknown as Page
}

describe('detectHandoffNeeded', () => {
  it('detects CAPTCHA', async () => {
    const result = await detectHandoffNeeded(mockPage({ type: 'captcha' }))
    expect(result).toEqual({
      type: 'captcha',
      url: 'https://example.com/login',
      action: expect.stringContaining('CAPTCHA'),
    })
  })

  it('detects 2FA', async () => {
    const result = await detectHandoffNeeded(mockPage({ type: '2fa' }))
    expect(result).toEqual({
      type: '2fa',
      url: 'https://example.com/login',
      action: expect.stringContaining('2FA'),
    })
  })

  it('detects login wall', async () => {
    const result = await detectHandoffNeeded(mockPage({ type: 'login_wall' }))
    expect(result).toEqual({
      type: 'login_wall',
      url: 'https://example.com/login',
      action: expect.stringContaining('Log in'),
    })
  })

  it('returns null when no handoff needed', async () => {
    const result = await detectHandoffNeeded(mockPage(null, 'https://example.com'))
    expect(result).toBeNull()
  })

  it('includes the current page URL', async () => {
    const result = await detectHandoffNeeded(
      mockPage({ type: 'captcha' }, 'https://myapp.com/dashboard'),
    )
    expect(result?.url).toBe('https://myapp.com/dashboard')
  })

  it('action mentions browser restart', async () => {
    const result = await detectHandoffNeeded(mockPage({ type: 'login_wall' }))
    expect(result?.action).toContain('openweb browser restart')
  })
})

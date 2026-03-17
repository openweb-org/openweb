import type { Page } from 'playwright'

export interface HumanHandoffNeeded {
  readonly type: 'captcha' | '2fa' | 'login_wall'
  readonly url: string
  readonly action: string
}

/**
 * Detect CAPTCHA, 2FA, or login wall conditions that require human intervention.
 * Uses lightweight DOM checks — never attempts to bypass.
 */
export async function detectHandoffNeeded(page: Page): Promise<HumanHandoffNeeded | null> {
  const url = page.url()

  const result = await page.evaluate(() => {
    // CAPTCHA detection: known iframe sources and class patterns
    const captchaIframes = document.querySelectorAll('iframe')
    for (const iframe of captchaIframes) {
      const src = iframe.src || ''
      if (/recaptcha|hcaptcha|turnstile|captcha/i.test(src)) {
        return { type: 'captcha' as const }
      }
    }
    // CAPTCHA class patterns on any element
    const captchaElements = document.querySelectorAll(
      '[class*="captcha" i], [id*="captcha" i], [class*="recaptcha" i], [class*="hcaptcha" i], [class*="turnstile" i]',
    )
    if (captchaElements.length > 0) {
      return { type: 'captcha' as const }
    }

    // 2FA detection: verification code inputs
    const twoFaInputs = document.querySelectorAll(
      'input[type="tel"], input[autocomplete="one-time-code"]',
    )
    for (const input of twoFaInputs) {
      const placeholder = (input as HTMLInputElement).placeholder || ''
      const label = input.getAttribute('aria-label') || ''
      const combined = `${placeholder} ${label}`
      if (/\b(code|verification|2fa|otp|verify|token)\b/i.test(combined)) {
        return { type: '2fa' as const }
      }
    }
    // Also check for 2FA-related headings/text
    for (const h of document.querySelectorAll('h1, h2, h3, label')) {
      const text = (h.textContent || '').trim()
      if (/\b(two.?factor|2fa|verification\s*code|verify\s*your|enter.*code)\b/i.test(text)) {
        return { type: '2fa' as const }
      }
    }

    // Login wall detection: password form on a login-patterned URL.
    // Require both signals to avoid flagging change-password or account settings pages.
    const path = window.location.pathname.toLowerCase()
    const isLoginUrl = /\/(login|signin|sign-in)\b/.test(path) && !/\/(callback|verify|confirm|reset)\b/.test(path)
    if (isLoginUrl) {
      const forms = document.querySelectorAll('form')
      for (const form of forms) {
        const hasPassword = form.querySelector('input[type="password"]') !== null
        const hasSubmit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])') !== null
        if (hasPassword && hasSubmit) {
          return { type: 'login_wall' as const }
        }
      }
    }

    return null
  })

  if (!result) return null

  const actions: Record<string, string> = {
    captcha: 'Complete the CAPTCHA in your browser, then run `openweb browser restart`',
    '2fa': 'Complete 2FA verification in your browser, then run `openweb browser restart`',
    login_wall: 'Log in at this URL in your default browser, then run `openweb browser restart`',
  }

  return {
    type: result.type,
    url,
    action: actions[result.type],
  }
}

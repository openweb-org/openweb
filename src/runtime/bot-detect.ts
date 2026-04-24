import type { Page } from 'patchright'

/**
 * Check the current page for common bot-detection / CAPTCHA signals.
 * Returns a descriptive string if bot block detected, undefined otherwise.
 *
 * Two layers of bot detection:
 * 1. This generic function — covers well-known vendor patterns (PerimeterX, DataDome, Cloudflare)
 * 2. Site-specific checks inside individual adapters — covers custom patterns (e.g., redfin rate-limit redirect)
 */
export async function detectPageBotBlock(page: Page): Promise<string | undefined> {
  try {
    const url = page.url()

    // DataDome challenge redirect (seen on reuters, tripadvisor)
    if (url.includes('captcha-delivery.com')) return `DataDome challenge: ${url}`
    // Cloudflare challenge redirect (seen in CDP tabs)
    if (url.includes('challenges.cloudflare.com')) return `Cloudflare challenge: ${url}`
    // eBay JS challenge or hCaptcha redirect
    if (url.includes('splashui/challenge') || url.includes('splashui/captcha')) return `eBay challenge: ${url}`

    const signal = await page.evaluate(`
      (() => {
        const t = document.title.toLowerCase();
        // PerimeterX "Access Denied" (confirmed on goodrx)
        if (t.includes('access denied')) return 'PerimeterX: ' + document.title;
        // Cloudflare challenge pages
        if (t.includes('attention required') || t.includes('just a moment')) return 'Cloudflare: ' + document.title;
        // eBay "Pardon Our Interruption" / "Checking your browser" / "Security Measure"
        if (t.includes('pardon our interruption') || t.includes('checking your browser') || t.includes('security measure')) return 'eBay challenge: ' + document.title;

        // PerimeterX press-and-hold CAPTCHA container
        if (document.querySelector('#px-captcha')) return 'PerimeterX CAPTCHA';
        // DataDome CAPTCHA iframe
        if (document.querySelector('iframe[src*="captcha-delivery.com"]')) return 'DataDome CAPTCHA';

        return null;
      })()
    `)
    return typeof signal === 'string' ? signal : undefined
  } catch {
    return undefined // page detached or navigation in progress
  }
}

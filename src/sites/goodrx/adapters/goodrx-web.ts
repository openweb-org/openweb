import type { Page } from 'patchright'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

type AdapterErrors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  botBlocked(msg: string): Error
}

/** Check if the page is showing a PerimeterX CAPTCHA / block page. */
async function isPxBlocked(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => '')
  if (title.toLowerCase().includes('access denied')) return true
  const hasCaptcha = await page.evaluate('!!document.querySelector("#px-captcha")').catch(() => false)
  return !!hasCaptcha
}

/** Navigate to a URL, retrying with cookie clears if PerimeterX blocks. */
async function navigateWithPxRetry(page: Page, url: string, maxRetries = 4): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Always reset before navigating — clears any poisoned PX state from
    // verify warm-up or previous adapter runs
    await page.goto('about:blank').catch(() => {})
    await page.context().clearCookies()
    await wait(1000 + attempt * 1000)
    await page.goto(url, { waitUntil: 'load', timeout: 20_000 }).catch(() => {})
    await wait(3000)
    if (!(await isPxBlocked(page))) return true
  }
  return false
}

async function searchDrugs(page: Page, params: Record<string, unknown>, errors: AdapterErrors) {
  const query = String(params.query || '')
  if (!query) throw errors.missingParam('query')

  const ok = await navigateWithPxRetry(page, 'https://www.goodrx.com')
  if (!ok) throw errors.botBlocked('PerimeterX blocked GoodRx homepage (CAPTCHA)')

  return page.evaluate(`
    (async () => {
      const q = ${JSON.stringify(query)};
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);
        const r = await fetch('/api/autocomplete?searchTerm=' + encodeURIComponent(q), {
          credentials: 'same-origin',
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (r.ok) {
          const data = await r.json();
          const items = (data.results || data.suggestions || data || []);
          if (Array.isArray(items) && items.length > 0) {
            return {
              count: items.length,
              results: items.map(i => ({
                name: typeof i === 'string' ? i : (i.name || i.display || i.label || ''),
                url: typeof i === 'string' ? '' : (i.url || i.slug ? 'https://www.goodrx.com/' + (i.slug || '') : ''),
              })).filter(r => r.name),
            };
          }
        }
      } catch {}

      // Fallback: extract drug links from the page
      const links = [...document.querySelectorAll('a[href]')];
      const seen = new Set();
      const results = [];
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        const match = href.match(/^\\/([a-z][a-z0-9-]+)$/);
        if (!match) continue;
        const slug = match[1];
        if (seen.has(slug)) continue;
        const skip = ['search','gold','care','brand','drugs','health','about','pets',
          'conditions','classes','mobile','discount-card','pharmacy-near-me',
          'how-goodrx-works','healthcare-professionals','out-of-pocket-costs'];
        if (skip.includes(slug)) continue;
        seen.add(slug);
        const name = a.textContent?.trim() || '';
        if (name.length < 2 || name.length > 50) continue;
        const lq = q.toLowerCase();
        if (name.toLowerCase().includes(lq) || slug.includes(lq)) {
          results.push({ name, url: 'https://www.goodrx.com/' + slug });
        }
      }
      return { count: results.length, results };
    })()
  `)
}

async function getDrugPrices(page: Page, params: Record<string, unknown>, errors: AdapterErrors) {
  const slug = String(params.slug || '')
  if (!slug) throw errors.missingParam('slug')

  const ok = await navigateWithPxRetry(page, `https://www.goodrx.com/${slug}`)
  if (!ok) throw errors.botBlocked('PerimeterX blocked GoodRx drug page (CAPTCHA)')

  return page.evaluate(`
    (() => {
      // Extract drug info from JSON-LD
      let drugName = null;
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const d = JSON.parse(s.textContent || '');
          if (d['@type'] === 'Drug') { drugName = d.name; break; }
        } catch {}
      }

      // Extract pharmacy prices from list items
      const lis = [...document.querySelectorAll('li')];
      const prices = [];
      for (const li of lis) {
        const text = li.textContent?.trim() || '';
        if (!text.includes('$') || text.length > 200) continue;
        const priceMatch = text.match(/\\$(\\d+\\.\\d{2})/);
        if (!priceMatch) continue;
        const parts = text.split('$');
        const pharmacy = parts[0].replace(/Pay online$/i, '').trim();
        if (pharmacy.length < 2 || pharmacy.length > 60) continue;
        prices.push({
          pharmacy,
          price: parseFloat(priceMatch[1]),
        });
      }
      return { drugName: drugName || document.title.split(' ')[0], count: prices.length, prices };
    })()
  `)
}

async function getPharmacies(page: Page, params: Record<string, unknown>, errors: AdapterErrors) {
  const zipCode = params.zipCode ? String(params.zipCode) : ''

  const url = zipCode
    ? `https://www.goodrx.com/pharmacy-near-me?zipCode=${encodeURIComponent(zipCode)}`
    : 'https://www.goodrx.com/pharmacy-near-me'

  const ok = await navigateWithPxRetry(page, url)
  if (!ok) throw errors.botBlocked('PerimeterX blocked GoodRx pharmacy page (CAPTCHA)')

  return page.evaluate(`
    (() => {
      // Extract pharmacy cards/links from the page
      const links = [...document.querySelectorAll('a[href*="/pharmacy/"]')];
      const seen = new Set();
      const pharmacies = [];

      for (const a of links) {
        const href = a.getAttribute('href') || '';
        const match = href.match(/\\/pharmacy\\/([a-z0-9-]+)/);
        if (!match) continue;
        const slug = match[1];
        if (seen.has(slug) || ['near-me', 'pharmacy-near-me'].includes(slug)) continue;
        seen.add(slug);

        const name = a.textContent?.trim() || '';
        if (name.length < 2 || name.length > 80) continue;

        pharmacies.push({
          name: name.split('\\n')[0].trim(),
          slug,
          url: 'https://www.goodrx.com/pharmacy/' + slug,
        });
      }
      return { count: pharmacies.length, pharmacies };
    })()
  `)
}

const adapter = {
  name: 'goodrx-web',
  description: 'GoodRx drug pricing — DOM extraction via browser with PerimeterX retry',

  async init(page: Page): Promise<boolean> {
    // If page is on PerimeterX CAPTCHA (from verify warm-up), clear cookies
    if (await isPxBlocked(page)) {
      await page.context().clearCookies()
    }
    return true
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // No auth required
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: Record<string, unknown>): Promise<unknown> {
    const { errors } = helpers as { errors: AdapterErrors }
    switch (operation) {
      case 'searchDrugs': return searchDrugs(page, { ...params }, errors)
      case 'getDrugPrices': return getDrugPrices(page, { ...params }, errors)
      case 'getPharmacies': return getPharmacies(page, { ...params }, errors)
      default: throw errors.unknownOp(operation)
    }
  },
}

export default adapter

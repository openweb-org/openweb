import type { Page } from 'patchright'

interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}

function validationError(msg: string): Error {
  return Object.assign(new Error(msg), { failureClass: 'fatal' })
}
function unknownOpError(op: string): Error {
  return Object.assign(new Error(`Unknown operation: ${op}`), { failureClass: 'fatal' })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function searchDrugs(page: Page, params: Record<string, unknown>) {
  const query = String(params.query || '')
  if (!query) throw validationError('query (drug name) is required')

  // Navigate to GoodRx and use internal search API via page context
  await page.goto('https://www.goodrx.com', { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)

  // Use GoodRx's internal autocomplete/search API from page context
  return page.evaluate(`
    (async () => {
      const q = ${JSON.stringify(query)};
      // Try the internal autocomplete endpoint
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

async function getDrugPrices(page: Page, params: Record<string, unknown>) {
  const slug = String(params.slug || '')
  if (!slug) throw validationError('slug (drug name slug, e.g. "metformin") is required')

  // Homepage warm-up for PerimeterX, then navigate to drug page
  await page.goto('https://www.goodrx.com', { waitUntil: 'load', timeout: 30_000 })
  await wait(2000)
  await page.goto(`https://www.goodrx.com/${slug}`, { waitUntil: 'load', timeout: 30_000 })
  await wait(4000)

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

async function getPharmacies(page: Page, params: Record<string, unknown>) {
  const zipCode = params.zipCode ? String(params.zipCode) : ''

  const url = zipCode
    ? `https://www.goodrx.com/pharmacy-near-me?zipCode=${encodeURIComponent(zipCode)}`
    : 'https://www.goodrx.com/pharmacy-near-me'

  await page.goto('https://www.goodrx.com', { waitUntil: 'load', timeout: 30_000 })
  await wait(2000)
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await wait(4000)

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

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchDrugs,
  getDrugPrices,
  getPharmacies,
}

const adapter: CodeAdapter = {
  name: 'goodrx-web',
  description: 'GoodRx drug pricing — DOM extraction via browser',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('goodrx.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // No auth required
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw unknownOpError(operation)
    return handler(page, { ...params })
  },
}

export default adapter

import type { Page } from 'patchright'

const SITE = 'https://www.indeed.com'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function navigateAndWait(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)
}

/* ---------- operations ---------- */

async function getSalary(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const title = String(params.title || '')
  if (!title) throw errors.missingParam('title')
  const location = params.location ? String(params.location) : ''
  const slug = title.toLowerCase().replace(/\s+/g, '-')
  const url = location
    ? `${SITE}/career/${encodeURIComponent(slug)}/salaries/${encodeURIComponent(location)}`
    : `${SITE}/career/${encodeURIComponent(slug)}/salaries`
  await navigateAndWait(page, url)
  return page.evaluate(`
    (() => {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el?.textContent) return { error: 'No salary data found' };
      try {
        const data = JSON.parse(el.textContent);
        const props = data?.props?.pageProps;
        if (!props) return { error: 'No pageProps found' };
        return {
          titleInfo: props.titleInfo,
          locationInfo: props.locationInfo,
          nationalSalaryAggregate: props.nationalSalaryAggregate,
          localSalaryAggregate: props.localSalaryAggregate,
          topPaidCities: props.topPaidCities,
          topPayingCompanies: props.topPayingCompanies,
          relatedTitlesResponse: props.relatedTitlesResponse,
        };
      } catch { return { error: 'Failed to parse salary data' }; }
    })()
  `)
}

async function autocompleteJobTitle(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const q = String(params.q || '')
  if (!q) throw errors.missingParam('q')
  const country = String(params.country || 'US')
  return page.evaluate(async ([query, ctry]: string[]) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const r = await fetch(
        `https://autocomplete.indeed.com/api/v0/suggestions/career-norm-job-title?query=${encodeURIComponent(query)}&country=${ctry}`,
        { signal: ctrl.signal },
      )
      return r.json()
    } finally { clearTimeout(timer) }
  }, [q, country])
}

async function autocompleteLocation(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const q = String(params.q || '')
  if (!q) throw errors.missingParam('q')
  const country = String(params.country || 'US')
  return page.evaluate(async ([query, ctry]: string[]) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const r = await fetch(
        `https://autocomplete.indeed.com/api/v0/suggestions/location?query=${encodeURIComponent(query)}&country=${ctry}`,
        { signal: ctrl.signal },
      )
      return r.json()
    } finally { clearTimeout(timer) }
  }, [q, country])
}

/* ---------- adapter export ---------- */

const adapter = {
  name: 'indeed-web',
  description: 'Indeed — salary slug + autocomplete fetch (ops requiring fetch or slug transform)',

  async init(_page: Page): Promise<boolean> {
    return true
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // All ops are public reads
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as { errors: { unknownOp(op: string): Error; missingParam(name: string): Error } }
    switch (operation) {
      case 'getSalary': return getSalary(page, { ...params }, errors)
      case 'autocompleteJobTitle': return autocompleteJobTitle(page, { ...params }, errors)
      case 'autocompleteLocation': return autocompleteLocation(page, { ...params }, errors)
      default: throw errors.unknownOp(operation)
    }
  },
}

export default adapter

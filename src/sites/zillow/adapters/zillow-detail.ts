import type { Page } from 'patchright'

/**
 * Zillow property detail adapter — extracts property, Zestimate, and
 * neighborhood data from __NEXT_DATA__ on property detail pages.
 *
 * URL pattern: /homedetails/{slug}/{zpid}_zpid/
 * Data source: SSR __NEXT_DATA__ (props.pageProps)
 * Bot detection: PerimeterX — requires page transport with real Chrome session
 */

async function navigateToProperty(page: Page, params: Record<string, unknown>): Promise<void> {
  const zpid = String(params.zpid ?? '')
  const slug = String(params.slug ?? '')
  if (!zpid) throw new Error('zpid is required')
  const url = `https://www.zillow.com/homedetails/${slug || '_'}/${zpid}_zpid/`
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
  await page.waitForSelector('script#__NEXT_DATA__', { timeout: 15_000 }).catch(() => {})
}

/** Extract parsed __NEXT_DATA__ from the page. */
function extractNextData(): string {
  return `
    (() => {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el) return null;
      try { return JSON.parse(el.textContent); } catch { return null; }
    })()
  `
}

/** Walk an object looking for a property record keyed by zpid or containing zpid. */
function findPropertyScript(zpid: string): string {
  return `
    (() => {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el) return null;
      let data;
      try { data = JSON.parse(el.textContent); } catch { return null; }

      const pp = data?.props?.pageProps || {};

      // Path 1: gdpClientCache (GraphQL data provider cache)
      const cache = pp.gdpClientCache;
      if (cache) {
        try {
          const parsed = typeof cache === 'string' ? JSON.parse(cache) : cache;
          for (const [key, val] of Object.entries(parsed)) {
            const v = typeof val === 'string' ? JSON.parse(val) : val;
            if (v?.property) return v.property;
          }
        } catch {}
      }

      // Path 2: componentProps or initialData
      for (const key of ['componentProps', 'initialData', 'property', 'listingData']) {
        const candidate = pp[key];
        if (candidate?.zpid || candidate?.property) return candidate.property || candidate;
      }

      // Path 3: deep search for zpid match in pageProps
      function findProp(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 4) return null;
        if (obj.zpid && String(obj.zpid) === '${zpid}') return obj;
        if (obj.property?.zpid) return obj.property;
        for (const v of Object.values(obj)) {
          const found = findProp(v, depth + 1);
          if (found) return found;
        }
        return null;
      }
      return findProp(pp, 0);
    })()
  `
}

/* ---------- getPropertyDetail ---------- */

async function getPropertyDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToProperty(page, params)
  const zpid = String(params.zpid ?? '')

  return page.evaluate(findPropertyScript(zpid)).then((prop: unknown) => {
    if (!prop || typeof prop !== 'object') return null
    const p = prop as Record<string, unknown>
    const addr = p.address as Record<string, unknown> | undefined
    const photos = Array.isArray(p.photos)
      ? (p.photos as Array<Record<string, unknown>>).slice(0, 10).map(
          (ph) => ph.mixedSources ?? ph.url ?? ph.href ?? null,
        )
      : Array.isArray(p.responsivePhotos)
        ? (p.responsivePhotos as Array<Record<string, unknown>>).slice(0, 10).map(
            (ph) => ph.mixedSources ?? ph.url ?? null,
          )
        : []

    return {
      zpid: p.zpid ?? null,
      address: addr
        ? {
            streetAddress: addr.streetAddress ?? null,
            city: addr.city ?? null,
            state: addr.state ?? null,
            zipcode: addr.zipcode ?? null,
          }
        : null,
      price: p.price ?? null,
      bedrooms: p.bedrooms ?? null,
      bathrooms: p.bathrooms ?? null,
      livingArea: p.livingArea ?? null,
      livingAreaUnits: p.livingAreaUnits ?? 'sqft',
      lotSize: p.lotSize ?? p.lotAreaValue ?? null,
      homeType: p.homeType ?? null,
      homeStatus: p.homeStatus ?? null,
      yearBuilt: p.yearBuilt ?? null,
      description: p.description ?? null,
      zestimate: p.zestimate ?? null,
      rentZestimate: p.rentZestimate ?? null,
      taxAssessedValue: p.taxAssessedValue ?? null,
      daysOnZillow: p.daysOnZillow ?? null,
      pageViewCount: p.pageViewCount ?? null,
      favoriteCount: p.favoriteCount ?? null,
      photos,
      url: `https://www.zillow.com/homedetails/_/${p.zpid}_zpid/`,
    }
  })
}

/* ---------- getZestimate ---------- */

async function getZestimate(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToProperty(page, params)
  const zpid = String(params.zpid ?? '')

  return page.evaluate(findPropertyScript(zpid)).then((prop: unknown) => {
    if (!prop || typeof prop !== 'object') return null
    const p = prop as Record<string, unknown>
    const addr = p.address as Record<string, unknown> | undefined

    // Zestimate history if available
    const history = Array.isArray(p.zestimateHistory)
      ? (p.zestimateHistory as Array<Record<string, unknown>>).slice(0, 12).map((h) => ({
          date: h.date ?? h.x ?? null,
          value: h.value ?? h.y ?? null,
        }))
      : null

    return {
      zpid: p.zpid ?? null,
      address: addr
        ? {
            streetAddress: addr.streetAddress ?? null,
            city: addr.city ?? null,
            state: addr.state ?? null,
            zipcode: addr.zipcode ?? null,
          }
        : null,
      zestimate: p.zestimate ?? null,
      rentZestimate: p.rentZestimate ?? null,
      zestimateLowPercent: p.zestimateLowPercent ?? null,
      zestimateHighPercent: p.zestimateHighPercent ?? null,
      taxAssessedValue: p.taxAssessedValue ?? null,
      taxAssessedYear: p.taxAssessedYear ?? null,
      price: p.price ?? null,
      homeType: p.homeType ?? null,
      livingArea: p.livingArea ?? null,
      bedrooms: p.bedrooms ?? null,
      bathrooms: p.bathrooms ?? null,
      zestimateHistory: history,
    }
  })
}

/* ---------- getNeighborhood ---------- */

async function getNeighborhood(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToProperty(page, params)
  const zpid = String(params.zpid ?? '')

  return page.evaluate(`
    (() => {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el) return null;
      let data;
      try { data = JSON.parse(el.textContent); } catch { return null; }
      const pp = data?.props?.pageProps || {};

      // Find property for basic context
      let prop = null;
      const cache = pp.gdpClientCache;
      if (cache) {
        try {
          const parsed = typeof cache === 'string' ? JSON.parse(cache) : cache;
          for (const [key, val] of Object.entries(parsed)) {
            const v = typeof val === 'string' ? JSON.parse(val) : val;
            if (v?.property) { prop = v.property; break; }
          }
        } catch {}
      }
      if (!prop) {
        for (const key of ['componentProps', 'initialData', 'property']) {
          const c = pp[key];
          if (c?.zpid || c?.property) { prop = c.property || c; break; }
        }
      }
      if (!prop) return null;

      // Schools
      const schools = Array.isArray(prop.schools)
        ? prop.schools.slice(0, 10).map(s => ({
            name: s.name || s.schoolName || null,
            rating: s.rating ?? s.greatSchoolsRating ?? null,
            level: s.level || s.grades || null,
            type: s.type || null,
            distance: s.distance ?? null,
            link: s.link || null,
          }))
        : [];

      // Nearby homes
      const nearby = Array.isArray(prop.nearbyHomes)
        ? prop.nearbyHomes.slice(0, 10).map(h => ({
            zpid: h.zpid ?? null,
            address: h.address?.streetAddress || h.streetAddress || null,
            price: h.price ?? null,
            bedrooms: h.bedrooms ?? null,
            bathrooms: h.bathrooms ?? null,
            livingArea: h.livingArea ?? null,
            homeType: h.homeType ?? null,
          }))
        : [];

      return {
        zpid: prop.zpid ?? null,
        address: prop.address ? {
          streetAddress: prop.address.streetAddress ?? null,
          city: prop.address.city ?? null,
          state: prop.address.state ?? null,
          zipcode: prop.address.zipcode ?? null,
        } : null,
        walkScore: prop.walkScore ?? null,
        transitScore: prop.transitScore ?? null,
        bikeScore: prop.bikeScore ?? null,
        schools,
        nearbyHomes: nearby,
      };
    })()
  `)
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  getPropertyDetail,
  getZestimate,
  getNeighborhood,
}

const adapter = {
  name: 'zillow-detail',
  description: 'Zillow property detail — extracts property info, Zestimate, and neighborhood data from __NEXT_DATA__',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('zillow.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // Property details are publicly accessible
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as { errors: { unknownOp(op: string): Error; missingParam(p: string): Error } }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    if (!params.zpid) throw errors.missingParam('zpid')
    return handler(page, { ...params })
  },
}

export default adapter

import type { Page } from 'patchright'

const SITE = 'https://www.yelp.com'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function navigateAndWait(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
  await wait(3000)
}

/* ---------- operations ---------- */

async function searchBusinesses(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const find_desc = String(params.find_desc || '')
  if (!find_desc) throw errors.missingParam('find_desc')
  const find_loc = String(params.find_loc || '')
  if (!find_loc) throw errors.missingParam('find_loc')
  const start = Number(params.start) || 0

  const url = new URL('/search', SITE)
  url.searchParams.set('find_desc', find_desc)
  url.searchParams.set('find_loc', find_loc)
  if (start > 0) url.searchParams.set('start', String(start))

  await navigateAndWait(page, url.toString())

  return page.evaluate(`
    (() => {
      // --- Parse SSR JSON for structured data ---
      const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
      const large = scripts.find(s => (s.textContent?.length || 0) > 50000);
      let ssrData = null;
      if (large) {
        let text = large.textContent || '';
        if (text.startsWith('<!--')) text = text.slice(4);
        if (text.endsWith('-->')) text = text.slice(0, -3);
        try { ssrData = JSON.parse(text.trim()); } catch {}
      }

      const lp = ssrData?.legacyProps;
      const spp = lp?.searchAppProps?.searchPageProps;
      const ssrItems = spp?.mainContentComponentsListProps || [];
      const ctx = spp?.searchContext || lp?.searchContext || {};

      // Build a map of bizId -> SSR data (ads have full data, organic has partial)
      const ssrMap = {};
      for (const item of ssrItems) {
        if (!item.bizId) continue;
        const b = item.searchResultBusiness;
        ssrMap[item.bizId] = {
          bizId: item.bizId,
          name: b?.name || null,
          alias: b?.alias || null,
          rating: b?.rating ?? null,
          reviewCount: b?.reviewCount ?? null,
          priceRange: b?.priceRange || null,
          phone: b?.phone || null,
          categories: b?.categories ? b.categories.map(c => c.title) : null,
          neighborhoods: b?.neighborhoods || null,
          address: b?.formattedAddress || null,
          isAd: item.isAd ?? b?.isAd ?? false,
          ranking: item.ranking ?? null,
          businessUrl: item.businessUrl || (b?.alias ? '/biz/' + b.alias : null),
          snippet: item.snippet?.text
            ?.replace(/\\[\\[HIGHLIGHT\\]\\]/g, '')
            ?.replace(/\\[\\[ENDHIGHLIGHT\\]\\]/g, '')
            || null,
        };
      }

      // --- DOM extraction for fields missing from SSR ---
      const cards = document.querySelectorAll('[data-testid="serp-ia-card"]');
      const domResults = Array.from(cards).map((card, idx) => {
        // Business name: find link with visible text
        const allLinks = Array.from(card.querySelectorAll('a'));
        const nameLink = allLinks.find(a => {
          const href = a.getAttribute('href') || '';
          const text = a.textContent?.trim() || '';
          return (href.includes('/biz/') || href.includes('/adredir')) && text.length > 1 && text.length < 100;
        });
        const name = nameLink?.textContent?.trim() || null;

        // Alias from href
        const href = nameLink?.getAttribute('href') || '';
        let alias = null;
        const bizMatch = href.match(/\\/biz\\/([^?&]+)/);
        if (bizMatch) alias = bizMatch[1];
        // For adredir, extract from redirect_url
        if (!alias && href.includes('/adredir')) {
          const redirectMatch = href.match(/redirect_url=.*?\\/biz\\/([^?&%]+)/);
          if (redirectMatch) alias = decodeURIComponent(redirectMatch[1]);
        }

        const isAd = href.includes('/adredir');

        // Rating
        const ratingEl = card.querySelector('[aria-label*="star rating"]');
        const ratingLabel = ratingEl?.getAttribute('aria-label') || '';
        const ratingMatch = ratingLabel.match(/([\\d.]+)\\s*star/);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

        // Review count
        const allText = card.innerText || '';
        const reviewMatch = allText.match(/\\((\\d[\\d,]*)\\s+reviews?\\)/);
        const reviewCount = reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, '')) : null;

        // Price range (match 1-4 dollar signs)
        const priceMatch = allText.match(/(?:^|\\n|\\s)(\\$\\$?\\$?\\$?)(?:\\n|$|Closed|Open)/m);
        const priceRange = priceMatch ? priceMatch[1] : null;

        // Categories
        const catEl = card.querySelector('[data-testid="serp-ia-categories"]');
        const categories = catEl
          ? Array.from(catEl.querySelectorAll('a')).map(c => c.textContent?.trim()).filter(Boolean)
          : [];

        // Neighborhood — text before price/hours
        const lines = allText.split('\\n').map(l => l.trim()).filter(Boolean);
        const ratingLineIdx = lines.findIndex(l => /^\\d.*star/.test(l) || /^\\(\\d/.test(l));
        let neighborhood = null;
        if (ratingLineIdx >= 0) {
          // neighborhood is typically right after the review count line
          for (let i = ratingLineIdx + 1; i < lines.length; i++) {
            const line = lines[i];
            if (/^[A-Z][a-zA-Z\\s-]+$/.test(line) && !line.includes('Closed') && !line.includes('Open') && line.length < 40) {
              neighborhood = line;
              break;
            }
          }
        }

        // Snippet
        const snippetMatch = allText.match(/"([^"]{20,})"/);
        const snippet = snippetMatch ? snippetMatch[1].replace(/\\.{3}$/, '…') : null;

        return { name, alias, rating, reviewCount, priceRange, categories, neighborhood, isAd, snippet, ranking: idx + 1 };
      });

      // --- Merge SSR + DOM: prefer SSR data, fill gaps from DOM ---
      const ssrBizIds = Object.keys(ssrMap);
      const businesses = [];

      // Use SSR ordering (includes ranking info) with DOM supplementation
      for (let i = 0; i < Math.max(ssrBizIds.length, domResults.length); i++) {
        const dom = domResults[i];
        if (!dom) continue;

        // Try to match SSR item by alias or by position
        let ssr = null;
        if (dom.alias) {
          ssr = Object.values(ssrMap).find(s => s.alias === dom.alias);
        }
        if (!ssr && dom.name) {
          ssr = Object.values(ssrMap).find(s => s.name === dom.name);
        }

        businesses.push({
          name: ssr?.name || dom.name,
          alias: ssr?.alias || dom.alias,
          url: ssr?.alias ? '/biz/' + ssr.alias : (dom.alias ? '/biz/' + dom.alias : null),
          rating: ssr?.rating ?? dom.rating,
          reviewCount: ssr?.reviewCount ?? dom.reviewCount,
          priceRange: ssr?.priceRange || dom.priceRange || null,
          phone: ssr?.phone || null,
          categories: ssr?.categories || (dom.categories.length ? dom.categories : []),
          neighborhoods: ssr?.neighborhoods || (dom.neighborhood ? [dom.neighborhood] : []),
          address: ssr?.address || null,
          isAd: ssr?.isAd ?? dom.isAd,
          snippet: ssr?.snippet || dom.snippet || null,
        });
      }

      return {
        businesses,
        totalResults: ctx.totalResults || null,
        resultsPerPage: ctx.resultsPerPage || null,
        startResult: ctx.startResult ?? null,
      };
    })()
  `)
}

/* ---------- adapter export ---------- */

const adapter = {
  name: 'yelp-web',
  description: 'Yelp — business search via page extraction (SSR + DOM)',

  async init(_page: Page): Promise<boolean> {
    return true
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // Search is public
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as { errors: { unknownOp(op: string): Error; missingParam(name: string): Error } }
    switch (operation) {
      case 'searchBusinesses': return searchBusinesses(page, { ...params }, errors)
      default: throw errors.unknownOp(operation)
    }
  },
}

export default adapter

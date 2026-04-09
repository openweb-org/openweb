import type { Page } from 'patchright'

/**
 * Netflix adapter — DOM extraction from the Netflix web app.
 *
 * Netflix's internal Shakti/Falkor APIs use per-request signing and
 * encrypted payloads that change across deployments. DOM extraction
 * from the authenticated web app is the reliable path.
 *
 * Requires: logged-in Netflix session (browser with active cookies).
 */

const BASE = 'https://www.netflix.com'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Errors = {
  missingParam(name: string): Error
  unknownOp(op: string): Error
  botBlocked(detail?: string): Error
}

async function waitForContent(page: Page, selector: string, timeout = 15_000): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout })
  } catch {
    // Content may already be present or layout differs — continue with best-effort extraction
  }
}

async function checkAuth(page: Page): Promise<boolean> {
  return page.evaluate(`
    (() => {
      // Netflix redirects unauthenticated users to /login or shows a signup page
      const path = window.location.pathname;
      if (path.startsWith('/login') || path === '/' || path.startsWith('/signup')) return false;
      // Check for profile gate or browse content
      return document.querySelector('[data-uia="profile-gate"]') !== null
        || document.querySelector('.mainView, .lolomo, [data-uia="nmhp-card"]') !== null
        || path.startsWith('/browse')
        || path.startsWith('/search')
        || path.startsWith('/title');
    })()
  `)
}

async function searchTitles(page: Page, params: Record<string, unknown>, errors: Errors) {
  const query = String(params.query || '')
  if (!query) throw errors.missingParam('query')

  await page.goto(`${BASE}/search?q=${encodeURIComponent(query)}`, {
    waitUntil: 'load',
    timeout: 30_000,
  })
  await wait(3000)
  await waitForContent(page, '[data-uia="search-result-item"], .title-card, .rowContainer')

  return page.evaluate(`
    (() => {
      const results = [];
      // Try multiple selector strategies — Netflix UI changes frequently
      const cards = document.querySelectorAll(
        '[data-uia="search-result-item"], .title-card-container, .slider-item'
      );
      for (const card of cards) {
        const link = card.querySelector('a[href*="/title/"], a[href*="/watch/"]');
        const img = card.querySelector('img');
        const titleEl = card.querySelector('.fallback-text, [aria-label], .title-card-title');
        const href = link?.getAttribute('href') || '';
        const idMatch = href.match(/\\/(title|watch)\\/(\\d+)/);
        results.push({
          id: idMatch ? idMatch[2] : '',
          title: titleEl?.textContent?.trim()
            || img?.getAttribute('alt')?.trim()
            || card.getAttribute('aria-label')?.trim()
            || '',
          image: img?.getAttribute('src') || '',
          link: href ? 'https://www.netflix.com' + href : '',
        });
      }
      return {
        query: new URLSearchParams(window.location.search).get('q') || '',
        resultCount: results.filter(r => r.title).length,
        items: results.filter(r => r.title),
      };
    })()
  `)
}

async function getTitleDetail(page: Page, params: Record<string, unknown>, errors: Errors) {
  const titleId = String(params.titleId || '')
  if (!titleId) throw errors.missingParam('titleId')

  await page.goto(`${BASE}/title/${titleId}`, {
    waitUntil: 'load',
    timeout: 30_000,
  })
  await wait(3000)
  await waitForContent(page, '[data-uia="title-info"], .previewModal--info, .about-wrapper')

  return page.evaluate(`
    (() => {
      const g = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
      const gAll = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent?.trim()).filter(Boolean);

      // Title info — try multiple selectors for different page layouts
      const title = g('[data-uia="title-info-title"], .previewModal--player-titleTreatment-logo, h1, [data-uia="hero-title"]')
        || document.querySelector('[data-uia="title-info-title"] img, .title-logo')?.getAttribute('alt') || '';

      const synopsis = g('[data-uia="title-info-synopsis"], .previewModal--text, .about-wrapper .synopsis, [data-uia="modal-synopsis"]');

      const maturityRating = g('[data-uia="title-info-maturity-rating"], .maturity-number, .maturity-rating');

      const year = g('[data-uia="title-info-metadata-year"], .year');

      const duration = g('[data-uia="title-info-duration"], .duration');

      // Genres/tags
      const genres = gAll('[data-uia="title-info-metadata-genre"] a, .previewModal--tags .tag-item, [data-uia="modal-genre"] a');

      // Cast
      const cast = gAll('[data-uia="title-info-metadata-cast"] a, .about-wrapper .about-container a[href*="person"], [data-uia="modal-cast"] a');

      // Seasons (for TV shows)
      const seasonSelector = document.querySelector('[data-uia="dropdown-season-selector"], .episodeSelector--dropdown, select[data-uia]');
      const seasonCount = seasonSelector
        ? (seasonSelector.querySelectorAll('option').length || 0)
        : 0;

      // Episodes (if visible)
      const episodes = [...document.querySelectorAll('[data-uia="episode-item"], .episodeWrapper, .episode-item')].map(ep => ({
        title: ep.querySelector('.episodeTitle, [data-uia="episode-title"]')?.textContent?.trim() || '',
        synopsis: ep.querySelector('.episodeSynopsis, [data-uia="episode-synopsis"]')?.textContent?.trim() || '',
        duration: ep.querySelector('.episodeDuration, [data-uia="episode-duration"]')?.textContent?.trim() || '',
      })).filter(e => e.title);

      const image = document.querySelector('[data-uia="title-info-image"] img, .previewModal--player-titleTreatment-logo, meta[property="og:image"]');
      const imageUrl = image?.getAttribute('src') || image?.getAttribute('content') || '';

      return {
        titleId: window.location.pathname.match(/\\/(title|watch)\\/(\\d+)/)?.[2] || '',
        title,
        synopsis,
        maturityRating,
        year,
        duration,
        genres,
        cast,
        seasonCount: seasonCount || undefined,
        episodes: episodes.length ? episodes : undefined,
        image: imageUrl,
      };
    })()
  `)
}

async function getCategories(page: Page) {
  await page.goto(`${BASE}/browse`, {
    waitUntil: 'load',
    timeout: 30_000,
  })
  await wait(3000)
  await waitForContent(page, '.lolomo, .rowContainer, [data-uia="nmhp-card"]')

  // Scroll down to load more genre rows
  await page.evaluate('window.scrollBy(0, 2000)')
  await wait(2000)

  return page.evaluate(`
    (() => {
      const categories = [];
      const rows = document.querySelectorAll(
        '.lolomoRow, [data-list-context], .rowContainer'
      );
      for (const row of rows) {
        const header = row.querySelector(
          '.rowHeader .rowTitle, [data-uia="title-card-list-header"], .row-header-title, .rowTitle a, .rowTitle span'
        );
        const name = header?.textContent?.trim() || '';
        if (!name) continue;
        const link = header?.closest('a')?.getAttribute('href')
          || row.querySelector('.rowTitle a')?.getAttribute('href') || '';
        const items = row.querySelectorAll(
          '.title-card-container, .slider-item, [data-uia="title-card"]'
        );
        categories.push({
          name,
          link: link ? 'https://www.netflix.com' + link : '',
          titleCount: items.length,
        });
      }
      return { categories };
    })()
  `)
}

async function getTopPicks(page: Page) {
  await page.goto(`${BASE}/browse`, {
    waitUntil: 'load',
    timeout: 30_000,
  })
  await wait(3000)
  await waitForContent(page, '.lolomo, .rowContainer, [data-uia="nmhp-card"]')

  return page.evaluate(`
    (() => {
      const items = [];
      // Extract from the first visible row (typically "Trending Now" or "Popular on Netflix")
      const firstRow = document.querySelector('.lolomoRow, [data-list-context], .rowContainer');
      const rowTitle = firstRow?.querySelector('.rowTitle')?.textContent?.trim() || 'Top Picks';

      const cards = document.querySelectorAll(
        '.lolomoRow:first-of-type .title-card-container, .rowContainer:first-of-type .slider-item, [data-uia="nmhp-card"]'
      );
      // Fall back to all visible title cards if row-scoped query finds nothing
      const targets = cards.length ? cards : document.querySelectorAll('.title-card-container, .slider-item');

      let rank = 0;
      for (const card of targets) {
        rank++;
        const link = card.querySelector('a[href*="/title/"], a[href*="/watch/"]');
        const img = card.querySelector('img');
        const titleEl = card.querySelector('.fallback-text, [aria-label], .title-card-title');
        const href = link?.getAttribute('href') || '';
        const idMatch = href.match(/\\/(title|watch)\\/(\\d+)/);
        items.push({
          rank,
          id: idMatch ? idMatch[2] : '',
          title: titleEl?.textContent?.trim()
            || img?.getAttribute('alt')?.trim()
            || card.getAttribute('aria-label')?.trim()
            || '',
          image: img?.getAttribute('src') || '',
          link: href ? 'https://www.netflix.com' + href : '',
        });
        if (rank >= 20) break;
      }
      return {
        section: rowTitle,
        items: items.filter(i => i.title),
      };
    })()
  `)
}

const adapter = {
  name: 'netflix',
  description: 'Netflix — search titles, view details, browse categories, see trending',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('netflix.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    return checkAuth(page)
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as { errors: Errors }
    switch (operation) {
      case 'searchTitles': return searchTitles(page, { ...params }, errors)
      case 'getTitleDetail': return getTitleDetail(page, { ...params }, errors)
      case 'getCategories': return getCategories(page)
      case 'getTopPicks': return getTopPicks(page)
      default: throw errors.unknownOp(operation)
    }
  },
}

export default adapter

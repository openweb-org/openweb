import type { Page } from 'patchright'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getReviews(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const bookId = String(params.bookId || '')
  if (!bookId) throw errors.missingParam('bookId')
  await page.goto(`https://www.goodreads.com/book/show/${encodeURIComponent(bookId)}`, { waitUntil: 'load', timeout: 30_000 })
  // Reviews load asynchronously via GraphQL — wait for them
  await page.waitForSelector('[data-testid="name"]', { timeout: 15_000 }).catch(() => {})
  await wait(1000)
  return page.evaluate(`
    (() => {
      const cards = document.querySelectorAll('[class*="ReviewCard"]');
      const seen = new Set();
      const reviews = [];
      for (const card of cards) {
        const nameEl = card.querySelector('[data-testid="name"] a, .ReviewerProfile__name a');
        const name = nameEl?.textContent?.trim() || '';
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const ratingEl = card.querySelector('[aria-label*="Rating"]');
        const ratingLabel = ratingEl?.getAttribute('aria-label') || '';
        const ratingMatch = ratingLabel.match(/(\\d)/);
        const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : null;
        const textEl = card.querySelector('[class*="TruncatedContent"] [class*="Formatted"]');
        const text = textEl?.textContent?.trim() || '';
        const dateEl = card.querySelector('a[href*="/review/show/"]');
        const date = dateEl?.textContent?.trim() || null;
        const likesEl = card.querySelector('[class*="SocialFooter"] [class*="like"] span');
        const likes = likesEl ? parseInt(likesEl.textContent.replace(/[^\\d]/g, ''), 10) || 0 : null;
        reviews.push({ name, rating, text: text.substring(0, 2000), date, likes });
      }
      return { totalReviews: reviews.length, reviews: reviews.slice(0, 30) };
    })()
  `)
}

const adapter = {
  name: 'goodreads',
  description: 'Goodreads — get book reviews with ratings',

  async init(page: Page): Promise<boolean> {
    return true
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as { errors: { unknownOp(op: string): Error; missingParam(name: string): Error } }
    switch (operation) {
      case 'getReviews': return getReviews(page, { ...params }, errors)
      default: throw errors.unknownOp(operation)
    }
  },
}

export default adapter

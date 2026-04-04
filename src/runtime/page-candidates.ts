import type { BrowserContext, Page } from 'patchright'

export async function listCandidatePages(context: BrowserContext): Promise<Page[]> {
  const candidates: Page[] = []
  for (const page of context.pages()) {
    try {
      const currentUrl = page.url()
      if (!currentUrl) {
        continue
      }

      const pathname = new URL(currentUrl).pathname
      if (pathname.endsWith('.js')) {
        continue
      }

      const content = (await page.content()).trim()
      if (!content) {
        continue
      }

      candidates.push(page)
    } catch {
      // intentional: detached pages and about:blank URLs fail URL parse
    }
  }

  return candidates
}

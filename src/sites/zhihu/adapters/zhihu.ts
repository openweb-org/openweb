import type { Page } from 'patchright'
import type { AdapterHelpers, CodeAdapter } from '../../../types/adapter.js'

async function getXsrfToken(page: Page, errors: AdapterHelpers['errors']): Promise<string> {
  const cookies = await page.context().cookies('https://www.zhihu.com')
  const xsrf = cookies.find((c) => c.name === '_xsrf')
  if (!xsrf?.value) throw errors.needsLogin()
  return xsrf.value
}

async function cancelUpvote(
  page: Page,
  params: Record<string, unknown>,
  helpers: AdapterHelpers,
): Promise<unknown> {
  const answerId = params.answer_id
  if (!answerId) throw helpers.errors.missingParam('answer_id')
  const xsrf = await getXsrfToken(page, helpers.errors)
  const result = await helpers.pageFetch(page, {
    url: `https://www.zhihu.com/api/v4/answers/${answerId}/voters`,
    method: 'POST',
    body: JSON.stringify({ type: 'neutral' }),
    headers: {
      'Content-Type': 'application/json',
      'x-xsrftoken': xsrf,
    },
  })
  return JSON.parse(result.text)
}

const adapter: CodeAdapter = {
  name: 'zhihu',
  description: 'Zhihu (知乎) — reverse write ops via page-context POST',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('zhihu.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://www.zhihu.com')
    return cookies.some((c) => c.name === '_xsrf' && c.value.length > 0)
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: AdapterHelpers,
  ): Promise<unknown> {
    switch (operation) {
      case 'cancelUpvote':
        return cancelUpvote(page, { ...params }, helpers)
      default:
        throw helpers.errors.unknownOp(operation)
    }
  },
}

export default adapter

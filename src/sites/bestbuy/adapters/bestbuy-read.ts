import type { CustomRunner } from '../../../types/adapter.js'

type Params = Readonly<Record<string, unknown>>

const BASE = 'https://www.bestbuy.com'
const SEARCH_CLIENT_ID = 'Search-Web-View'

async function searchProducts(ctx: { page: NonNullable<import('patchright').Page>; helpers: import('../../../types/adapter.js').AdapterHelpers }, params: Params): Promise<unknown> {
  const query = String(params.query ?? '')
  if (!query) throw ctx.helpers.errors.missingParam('query')
  const count = Number(params.count ?? 11)
  const searchVariant = String(params.searchVariant ?? 'B')

  const url = `${BASE}/suggest/v1/fragment/suggest/www?query=${encodeURIComponent(query)}&count=${count}&searchVariant=${searchVariant}`
  const resp = await ctx.helpers.pageFetch(ctx.page, {
    url,
    method: 'GET',
    headers: { 'x-client-id': SEARCH_CLIENT_ID },
  })
  if (resp.status !== 200) throw ctx.helpers.errors.httpError(resp.status)
  const body = JSON.parse(resp.text) as Record<string, unknown>

  const sr = body.suggestionResponse as Record<string, unknown> | undefined
  if (!sr) return body

  const suggestions = (sr.suggestions as Array<Record<string, unknown>>) ?? []
  return {
    suggestionResponse: {
      spellCheck: sr.spellCheck ?? null,
      count: sr.count ?? 0,
      suggestions: suggestions.map((s) => ({
        term: s.term,
        category: s.category ?? [],
        products: ((s.products as Array<Record<string, unknown>>) ?? []).map((p) => ({
          skuId: p.skuId,
        })),
      })),
    },
  }
}

async function getProductDetails(ctx: { page: NonNullable<import('patchright').Page>; helpers: import('../../../types/adapter.js').AdapterHelpers }, params: Params): Promise<unknown> {
  const skuids = String(params.skuids ?? '')
  if (!skuids) throw ctx.helpers.errors.missingParam('skuids')

  const url = `${BASE}/suggest/v1/fragment/products/www?skuids=${encodeURIComponent(skuids)}`
  const resp = await ctx.helpers.pageFetch(ctx.page, {
    url,
    method: 'GET',
    headers: { 'x-client-id': SEARCH_CLIENT_ID },
  })
  if (resp.status !== 200) throw ctx.helpers.errors.httpError(resp.status)
  const body = JSON.parse(resp.text) as Record<string, unknown>

  const products = (body.products as Array<Record<string, unknown>>) ?? []
  return {
    count: body.count ?? products.length,
    products: products.map((p) => ({
      skuid: p.skuid,
      skushortlabel: p.skushortlabel,
      pdpUrl: p.pdpUrl ?? null,
      imageUrl: p.imageUrl ?? null,
      customerrating_facet: p.customerrating_facet ?? null,
      numberofreviews_facet: p.numberofreviews_facet ?? null,
    })),
  }
}

async function getProductPricing(ctx: { page: NonNullable<import('patchright').Page>; helpers: import('../../../types/adapter.js').AdapterHelpers }, params: Params): Promise<unknown> {
  const skus = String(params.skus ?? '')
  if (!skus) throw ctx.helpers.errors.missingParam('skus')

  const url = `${BASE}/api/3.0/priceBlocks?skus=${encodeURIComponent(skus)}`
  const resp = await ctx.helpers.pageFetch(ctx.page, { url, method: 'GET' })
  if (resp.status !== 200) throw ctx.helpers.errors.httpError(resp.status)
  const body = JSON.parse(resp.text) as Array<Record<string, unknown>>

  return body.map((item) => {
    const sku = item.sku as Record<string, unknown> | undefined
    if (!sku) return item

    if (sku.error) {
      return { sku: { skuId: sku.skuId, error: sku.error } }
    }

    const price = sku.price as Record<string, unknown> | undefined
    const buttonState = sku.buttonState as Record<string, unknown> | undefined
    const brand = sku.brand as Record<string, unknown> | undefined
    const names = sku.names as Record<string, unknown> | undefined

    return {
      sku: {
        skuId: sku.skuId,
        condition: sku.condition ?? null,
        productType: sku.productType ?? null,
        brand: brand ? { brand: brand.brand } : null,
        names: names ? { short: names.short } : null,
        price: price ? {
          currentPrice: price.currentPrice ?? null,
          regularPrice: price.regularPrice ?? null,
          pricingType: price.pricingType ?? null,
          savingsAmount: price.savingsAmount ?? null,
        } : null,
        buttonState: buttonState ? {
          purchasable: buttonState.purchasable ?? null,
          buttonState: buttonState.buttonState ?? null,
          displayText: buttonState.displayText ?? null,
        } : null,
        url: sku.url ?? null,
      },
    }
  })
}

const adapter: CustomRunner = {
  name: 'bestbuy-read',
  description: 'Best Buy — read operations with response trimming',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('bestbuy-read adapter requires a browser page')

    switch (operation) {
      case 'searchProducts':
        return searchProducts({ page, helpers }, params)
      case 'getProductDetails':
        return getProductDetails({ page, helpers }, params)
      case 'getProductPricing':
        return getProductPricing({ page, helpers }, params)
      default:
        throw helpers.errors.unknownOp(operation)
    }
  },
}

export default adapter

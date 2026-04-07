import type { Page } from 'patchright'

export const GRAPHQL_URL = 'https://www.instacart.com/graphql'

export const HASHES: Record<string, string> = {
  CrossRetailerSearchAutosuggestions: '89ec32ea85c9b7ea89f7b4a071a5dd4ec1335831ff67035a0f92376725c306a3',
  Items: '5116339819ff07f207fd38f949a8a7f58e52cc62223b535405b087e3076ebf2f',
  GetAccurateRetailerEtas: '382a4e539ffafb2d566b24009cd9bc4b796727b4bb93716a239e349dcc21e864',
  CollectionProductsWithFeaturedProducts: '5573f6ef85bfad81463b431985396705328c5ac3283c4e183aa36c6aad1afafe',
  ShopCollectionScoped: 'c6a0fcb3d1a4a14e5800cc6c38e736e85177f80f0c01a5535646f83238e65bcb',
  ContextualizedShopsGroupQuery: '0bc96ac1b8ea30b5c1d9e4b19910745305ff902000d372c35fe107ac6b6ab18e',
  GeolocationFromIp: 'c6172e49ede2ba281e14f794bb9ea7c27bb28fb68af985c975e20ee1b501ec09',
}

export async function graphqlGet(
  page: Page,
  operationName: string,
  variables: Record<string, unknown>,
  errors: { fatal(msg: string): Error; httpError(status: number): Error; apiError(label: string, msg: string): Error },
): Promise<unknown> {
  const hash = HASHES[operationName]
  if (!hash) {
    throw errors.fatal(`No persisted query hash for ${operationName}`)
  }

  const params = new URLSearchParams({
    operationName,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }),
  })

  const url = `${GRAPHQL_URL}?${params.toString()}`

  const result = await page.evaluate(
    async (fetchUrl: string) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const resp = await fetch(fetchUrl, { credentials: 'include', signal: ctrl.signal })
        return { status: resp.status, text: await resp.text() }
      } finally {
        clearTimeout(timer)
      }
    },
    url,
  )

  if (result.status >= 400) {
    throw errors.httpError(result.status)
  }

  const json = JSON.parse(result.text) as { data?: unknown; errors?: unknown[] }
  if (json.errors?.length) {
    const msg = (json.errors[0] as Record<string, string>)?.message ?? 'Unknown GraphQL error'
    throw errors.apiError(operationName, msg)
  }

  return json.data
}

export function normalizeItem(item: Record<string, unknown>): unknown {
  const price = item.price as Record<string, unknown> | undefined
  const priceSection = price?.viewSection as Record<string, unknown> | undefined
  const itemCard = priceSection?.itemCard as Record<string, unknown> | undefined
  const availability = item.availability as Record<string, unknown> | undefined
  const avSection = availability?.viewSection as Record<string, unknown> | undefined

  return {
    id: item.id,
    productId: item.productId,
    name: item.name,
    size: item.size,
    brandName: item.brandName,
    price: itemCard?.priceString ?? null,
    pricePerUnit: itemCard?.pricePerUnitString ?? null,
    imageUrl: item.evergreenUrl ?? null,
    available: availability?.available ?? null,
    stockLevel: avSection?.stockLevelLabelString ?? null,
  }
}

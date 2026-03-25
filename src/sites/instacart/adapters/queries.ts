import type { Page } from 'playwright-core'
import { OpenWebError } from '../../../lib/errors.js'

export const GRAPHQL_URL = 'https://www.instacart.com/graphql'

/* ---------- persisted query hashes ---------- */

export const HASHES: Record<string, string> = {
  CrossRetailerSearchAutosuggestions: '89ec32ea85c9b7ea89f7b4a071a5dd4ec1335831ff67035a0f92376725c306a3',
  Items: '5116339819ff07f207fd38f949a8a7f58e52cc62223b535405b087e3076ebf2f',
  GetProductRatings: 'e0ce69452493f19ece52d62a48a60693831b6ded4fd599633d01ab1d4f88f0b6',
  ProductNutritionalInfo: '9bc43a13c48e633ba4c8016118f101942a44603c5d10f913e9e471ffb730185a',
  GetAccurateRetailerEtas: '382a4e539ffafb2d566b24009cd9bc4b796727b4bb93716a239e349dcc21e864',
  DeliveryHoursInfo: '2b97847310c31a0f645245a08e70fce597a63b04afeb23df39fa654adae453a9',
  DepartmentNavCollections: 'e5231eab24795280ff3e556c24ddfedaed6d9d553a856fa20670428087a21ecb',
  LandingRetailerMetas: 'b8ae98edc10398530e845b5458fed2d63b7024cf3cbd7c0312c9873e494f3d56',
  CollectionProductsWithFeaturedProducts: '5573f6ef85bfad81463b431985396705328c5ac3283c4e183aa36c6aad1afafe',
  RecipesByProductId: '50fda365068f6cfae1bf2905d12a28fb790a69af95b41178742093cc9183d2b5',
}

/* ---------- GraphQL fetch ---------- */

export async function graphqlGet(
  page: Page,
  operationName: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const hash = HASHES[operationName]
  if (!hash) throw OpenWebError.apiError(operationName, 'No persisted query hash')

  const params = new URLSearchParams({
    operationName,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }),
  })

  const url = `${GRAPHQL_URL}?${params.toString()}`

  const result = await page.evaluate(
    async (fetchUrl: string) => {
      const resp = await fetch(fetchUrl, { credentials: 'include' })
      return { status: resp.status, text: await resp.text() }
    },
    url,
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  const json = JSON.parse(result.text) as { data?: unknown; errors?: unknown[] }
  if (json.errors?.length) {
    const msg = (json.errors[0] as Record<string, string>)?.message ?? 'Unknown GraphQL error'
    throw OpenWebError.apiError('GraphQL ' + operationName, msg)
  }

  return json.data
}

/* ---------- shared helpers ---------- */

export function normalizeItem(item: Record<string, unknown>): unknown {
  const price = item.price as Record<string, unknown> | undefined
  const priceSection = (price?.viewSection as Record<string, unknown>)
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
    available: (availability as Record<string, unknown>)?.available ?? null,
    stockLevel: avSection?.stockLevelLabelString ?? null,
  }
}

export async function getSearchResults(page: Page, query: string): Promise<unknown[]> {
  const items: unknown[] = []

  const handler = async (response: { url(): string; json(): Promise<unknown> }) => {
    if (response.url().includes('operationName=Items')) {
      try {
        const body = (await response.json()) as { data?: { items?: unknown[] } }
        if (body.data?.items) {
          for (const item of body.data.items) {
            items.push(normalizeItem(item as Record<string, unknown>))
          }
        }
      } catch { /* ignore */ }
    }
  }

  page.on('response', handler)
  try {
    const searchUrl = `https://www.instacart.com/store/s?k=${encodeURIComponent(query)}`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}) // intentional: best-effort navigation
    await page.waitForTimeout(5000)
  } finally {
    page.off('response', handler)
  }

  return items
}

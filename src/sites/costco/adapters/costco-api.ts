import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'
/**
 * Costco L3 adapter — POST-based APIs via Playwright request context.
 *
 * Search: POST gdx-api.costco.com/catalog/search/api/v1/search
 * Suggest: POST gdx-api.costco.com/catalog/search/api/v1/suggest
 * Product: POST ecom-api.costco.com/ebusiness/product/v1/products/graphql
 * Reviews: page.evaluate BV widget state (BazaarVoice)
 * Warehouses: GET ecom-api.costco.com/core/warehouse-locator/v1/salesLocations.json
 * Delivery: GET ecom-api.costco.com/ebusiness/order/v1/delivery/options
 * Cart: POST www.costco.com/AjaxManageShoppingCartCmd (requires auth)
 *
 * PerimeterX intercepts window.fetch/XHR on costco.com, so we use
 * Playwright's page.request API which bypasses page JS interception
 * while inheriting browser cookies.
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  httpError(status: number): Error
  wrap(err: unknown): Error
}

const SEARCH_URL = 'https://gdx-api.costco.com/catalog/search/api/v1/search'
const SEARCH_TYPEAHEAD_URL = 'https://gdx-api.costco.com/catalog/search/api/v1/search?searchType=typeahead'
const PRODUCT_GRAPHQL_URL = 'https://ecom-api.costco.com/ebusiness/product/v1/products/graphql'
const WAREHOUSE_LOCATOR_URL = 'https://ecom-api.costco.com/core/warehouse-locator/v1/salesLocations.json'
const DELIVERY_OPTIONS_URL = 'https://ecom-api.costco.com/ebusiness/order/v1/delivery/options'
const CART_URL = 'https://www.costco.com/AjaxManageShoppingCartCmd'
const SEARCH_CLIENT_ID = '168287ea-1201-45f6-9b45-5bbea49f8ee7'
const PRODUCT_CLIENT_ID = '4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf'
const WAREHOUSE_CLIENT_ID = '7c71124c-7bf1-44db-bc9d-498584cd66e5'

/* ---------- product GraphQL query ---------- */

const PRODUCT_QUERY = `query {
  products(
    itemNumbers: [ITEM_NUMBERS],
    clientId: "${PRODUCT_CLIENT_ID}",
    locale: "en-us",
    warehouseNumber: "847"
  ) {
    catalogData {
      itemNumber
      itemId
      published
      buyable
      programTypes
      priceData { price listPrice }
      attributes { key value type }
      description {
        shortDescription
        longDescription
        marketingStatement
        promotionalStatement
      }
      additionalFieldData {
        rating
        numberOfRating
        eligibleForReviews
        membershipReqd
        maxItemOrderQty
      }
      fieldData { mfPartNumber mfName }
    }
  }
}`

/* ---------- helpers ---------- */

async function getJson(
  page: Page,
  url: string,
  errors: Errors,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const resp = await page.request.fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Origin: 'https://www.costco.com',
      Referer: 'https://www.costco.com/',
      ...extraHeaders,
    },
  })

  if (!resp.ok()) {
    throw errors.httpError(resp.status())
  }

  return resp.json()
}

async function postJson(
  page: Page,
  url: string,
  body: unknown,
  errors: Errors,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const resp = await page.request.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: '*/*',
      Origin: 'https://www.costco.com',
      Referer: 'https://www.costco.com/',
      ...extraHeaders,
    },
    data: JSON.stringify(body as Record<string, unknown>),
  })

  if (!resp.ok()) {
    throw errors.httpError(resp.status())
  }

  return resp.json()
}

/* ---------- operation handlers ---------- */

async function searchProducts(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const query = String(params.query ?? '')
  const pageSize = Number(params.pageSize ?? 24)
  const offset = Number(params.offset ?? 0)

  const body = {
    visitorId: '0',
    query,
    pageSize,
    offset,
    orderBy: null,
    searchMode: 'page',
    personalizationEnabled: false,
    warehouseId: '249-wh',
    shipToPostal: '95050',
    shipToState: 'CA',
    deliveryLocations: [
      '653-bd', '848-bd', '249-wh', '847_0-wm',
    ],
    filterBy: [],
    pageCategories: [],
    userInfo: { userId: '0' },
  }

  const resp = (await postJson(page, SEARCH_URL, body, errors, {
    'client-identifier': SEARCH_CLIENT_ID,
    client_id: 'USBC',
    locale: 'en-US',
    searchresultprovider: 'GRS',
  })) as Record<string, unknown>

  const searchResult = resp.searchResult as Record<string, unknown>
  const results = (searchResult?.results ?? []) as Array<Record<string, unknown>>

  const products = results.map((r) => {
    const product = r.product as Record<string, unknown>
    const attrs = (product?.attributes ?? {}) as Record<string, Record<string, unknown>>
    const primaryImage = (attrs.primary_image?.text as string[])?.[0] ?? null
    const pills = (attrs.pills?.text as string[]) ?? []
    const marketingStatement = (attrs.marketing_statement?.text as string[])?.[0] ?? null

    return {
      itemNumber: r.id,
      title: product?.title,
      brands: product?.brands,
      categories: product?.categories,
      imageUrl: primaryImage,
      pills,
      marketingStatement,
    }
  })

  return {
    query,
    totalCount: searchResult?.totalCount ?? results.length,
    products,
  }
}

async function getProductDetail(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const itemNumber = String(params.itemNumber ?? params.item_number ?? '')
  if (!itemNumber) throw errors.missingParam('itemNumber')

  const query = PRODUCT_QUERY.replace('ITEM_NUMBERS', `"${itemNumber}"`)
  const resp = (await postJson(page, PRODUCT_GRAPHQL_URL, { query }, errors, {
    'client-identifier': PRODUCT_CLIENT_ID,
    'costco.env': 'ecom',
    'costco.service': 'restProduct',
  })) as Record<string, unknown>

  const data = resp.data as Record<string, unknown>
  const products = data?.products as Record<string, unknown>
  const catalogData = (products?.catalogData as Array<Record<string, unknown>>) ?? []

  if (catalogData.length === 0) {
    return { product: null }
  }

  const item = catalogData[0]
  const attrs = (item.attributes as Array<Record<string, unknown>>) ?? []
  const desc = (item.description as Record<string, string>) ?? {}
  const priceData = (item.priceData as Record<string, string>) ?? {}
  const additionalData = (item.additionalFieldData as Record<string, unknown>) ?? {}
  const fieldData = (item.fieldData as Record<string, unknown>) ?? {}

  const attributes: Record<string, string[]> = {}
  for (const attr of attrs) {
    const key = String(attr.key)
    const value = String(attr.value)
    if (!attributes[key]) attributes[key] = []
    attributes[key].push(value)
  }

  return {
    product: {
      itemNumber: item.itemNumber,
      title: desc.shortDescription ?? null,
      longDescription: desc.longDescription ?? null,
      price: priceData.price ? Number.parseFloat(priceData.price) : null,
      listPrice: priceData.listPrice && priceData.listPrice !== '-1.00000'
        ? Number.parseFloat(priceData.listPrice)
        : null,
      marketingStatement: desc.marketingStatement ?? null,
      promotionalStatement: desc.promotionalStatement ?? null,
      brand: attributes.Brand?.[0] ?? (fieldData.mfName !== 'DO NOT DELETE' ? fieldData.mfName : null) ?? null,
      rating: additionalData.rating != null ? Number(additionalData.rating) : null,
      numberOfRatings: additionalData.numberOfRating != null ? Number(additionalData.numberOfRating) : null,
      buyable: item.buyable === 1,
      attributes,
    },
  }
}

/* ---------- reviews ---------- */

async function getProductReviews(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const productId = String(params.productId ?? params.itemNumber ?? '')
  if (!productId) throw errors.missingParam('productId')

  // Navigate to product page to trigger BV widget initialization
  const productUrl = `https://www.costco.com/p/-/${productId}?langId=-1`
  await page.goto(productUrl, { waitUntil: 'domcontentloaded' })

  // Wait for BV rating_summary to populate (polls every 500ms, max 10s)
  const bvData = await page.evaluate(async (pid: string) => {
    const maxWait = 10000
    const interval = 500
    let waited = 0
    while (waited < maxWait) {
      const bv = (window as Record<string, unknown>).BV as Record<string, unknown> | undefined
      const rs = bv?.rating_summary as Record<string, unknown> | undefined
      const apiData = rs?.apiData as Record<string, Record<string, unknown>> | undefined
      if (apiData?.[pid]) {
        const summary = apiData[pid]
        return JSON.stringify(summary)
      }
      await new Promise((r) => setTimeout(r, interval))
      waited += interval
    }
    return null
  }, productId)

  if (!bvData) {
    // Fallback: get basic rating from GraphQL
    const query = PRODUCT_QUERY.replace('ITEM_NUMBERS', `"${productId}"`)
    const resp = (await postJson(page, PRODUCT_GRAPHQL_URL, { query }, {
      'client-identifier': PRODUCT_CLIENT_ID,
      'costco.env': 'ecom',
      'costco.service': 'restProduct',
    }, errors)) as Record<string, unknown>
    const data = resp.data as Record<string, unknown>
    const products = data?.products as Record<string, unknown>
    const catalogData = (products?.catalogData as Array<Record<string, unknown>>) ?? []
    const item = catalogData[0]
    const addl = (item?.additionalFieldData as Record<string, unknown>) ?? {}
    return {
      productId,
      totalReviews: addl.numberOfRating != null ? Number(addl.numberOfRating) : 0,
      averageRating: addl.rating != null ? Number(addl.rating) : null,
      ratingDistribution: null,
      recommendedPercentage: null,
      reviews: [],
    }
  }

  const summary = JSON.parse(bvData) as Record<string, unknown>
  const reviewSummary = (summary.reviewSummary ?? {}) as Record<string, unknown>
  const primaryRating = (reviewSummary.primaryRating ?? {}) as Record<string, unknown>
  const recommended = (reviewSummary.recommended ?? {}) as Record<string, unknown>
  const recDist = (recommended.distribution ?? []) as Array<Record<string, unknown>>

  const yesCount = recDist.find((d) => d.key === true)?.count as number ?? 0
  const totalRec = recDist.reduce((sum, d) => sum + (d.count as number), 0)

  return {
    productId,
    totalReviews: reviewSummary.numReviews ?? 0,
    averageRating: primaryRating.average ?? null,
    ratingDistribution: primaryRating.distribution ?? null,
    recommendedPercentage: totalRec > 0 ? Math.round((yesCount / totalRec) * 100) : null,
    reviews: [],
  }
}

/* ---------- warehouse locator ---------- */

async function findWarehouses(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const latitude = params.latitude != null ? Number(params.latitude) : null
  const longitude = params.longitude != null ? Number(params.longitude) : null

  if (latitude == null || longitude == null) {
    throw errors.missingParam('latitude and longitude')
  }

  const limit = Number(params.limit ?? 10)

  const url = `${WAREHOUSE_LOCATOR_URL}?latitude=${latitude}&longitude=${longitude}&limit=${limit}`
  const resp = (await getJson(page, url, errors, {
    'client-identifier': WAREHOUSE_CLIENT_ID,
    'Accept-Language': 'en-us',
  })) as Record<string, unknown>

  const salesLocations = (resp.salesLocations ?? []) as Array<Record<string, unknown>>

  const warehouses = salesLocations.map((w) => {
    const address = (w.address as Record<string, unknown>) ?? {}
    const names = (w.name as Array<Record<string, string>>) ?? []
    const name = names.find((n) => n.localeCode === 'en-US')?.value ?? names[0]?.value ?? null

    // Format hours entries into readable strings
    const formatHours = (entries: Array<Record<string, unknown>>): string | null => {
      if (!entries?.length) return null
      return entries
        .filter((h) => {
          const type = (h.hoursType as Record<string, unknown>)?.code
          return type === 'open'
        })
        .map((h) => {
          const titles = (h.title as Array<Record<string, string>>) ?? []
          const label = titles.find((t) => t.localeCode === 'en-US')?.value ?? ''
          return `${label}: ${h.open} - ${h.close}`
        }).join('; ') || null
    }

    // Warehouse-level hours
    const warehouseHours = formatHours((w.hours as Array<Record<string, unknown>>) ?? [])

    // Service-level hours and service names
    const svcs = (w.services as Array<Record<string, unknown>>) ?? []
    const serviceMap: Record<string, string | null> = {}
    const serviceNames: string[] = []
    for (const svc of svcs) {
      const svcNames = (svc.name as Array<Record<string, string>>) ?? []
      const svcName = svcNames.find((n) => n.localeCode === 'en-US')?.value ?? ''
      serviceNames.push(svcName)
      const svcHours = formatHours((svc.hours as Array<Record<string, unknown>>) ?? [])
      if (svcHours) serviceMap[String(svc.code)] = svcHours
    }

    return {
      warehouseId: w.salesLocationId ?? null,
      name,
      phone: w.phone ?? null,
      address: {
        street: address.line1 ?? null,
        city: address.city ?? null,
        state: address.territory ?? null,
        zipCode: address.postalCode ?? null,
        country: address.countryName ?? null,
      },
      latitude: address.latitude ?? null,
      longitude: address.longitude ?? null,
      distance: w.distance ?? null,
      hours: {
        warehouse: warehouseHours,
        pharmacy: serviceMap.pharmacy ?? null,
        gasStation: serviceMap.gas ?? null,
        tireCenter: serviceMap.auto ?? null,
      },
      services: serviceNames,
    }
  })

  return { warehouses, totalCount: warehouses.length }
}

/* ---------- search suggestions ---------- */

async function searchSuggestions(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const query = String(params.query ?? '')
  if (!query) throw errors.missingParam('query')
  const limit = Number(params.limit ?? 10)

  const body = {
    visitorId: '0',
    query,
    pageSize: limit,
    offset: 0,
    searchMode: 'page',
    personalizationEnabled: false,
    warehouseId: '249-wh',
    shipToPostal: '95050',
    shipToState: 'CA',
    deliveryLocations: ['653-bd', '848-bd', '249-wh', '847_0-wm'],
    filterBy: [],
    pageCategories: [],
    userInfo: { userId: '0' },
  }

  const resp = (await postJson(page, SEARCH_TYPEAHEAD_URL, body, errors, {
    'client-identifier': SEARCH_CLIENT_ID,
    client_id: 'USBC',
    locale: 'en-US',
    searchresultprovider: 'GRS',
  })) as Record<string, unknown>

  const searchResult = resp.searchResult as Record<string, unknown>
  const results = (searchResult?.results ?? []) as Array<Record<string, unknown>>

  const suggestions = results.map((r) => {
    const product = r.product as Record<string, unknown>
    const categories = (product?.categories as string[]) ?? []
    return {
      term: product?.title ?? '',
      type: categories[0] ?? 'product',
    }
  })

  return { query, suggestions }
}

/* ---------- multiple products ---------- */

async function getMultipleProducts(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const itemNumbers = params.itemNumbers as string[] | undefined
  if (!itemNumbers?.length) throw errors.missingParam('itemNumbers')

  const quotedItems = itemNumbers.map((n) => `"${n}"`).join(', ')
  const query = PRODUCT_QUERY.replace('ITEM_NUMBERS', quotedItems)
  const resp = (await postJson(page, PRODUCT_GRAPHQL_URL, { query }, errors, {
    'client-identifier': PRODUCT_CLIENT_ID,
    'costco.env': 'ecom',
    'costco.service': 'restProduct',
  })) as Record<string, unknown>

  const data = resp.data as Record<string, unknown>
  const products = data?.products as Record<string, unknown>
  const catalogData = (products?.catalogData as Array<Record<string, unknown>>) ?? []

  return {
    products: catalogData.map((item) => {
      const attrs = (item.attributes as Array<Record<string, unknown>>) ?? []
      const desc = (item.description as Record<string, string>) ?? {}
      const priceData = (item.priceData as Record<string, string>) ?? {}
      const additionalData = (item.additionalFieldData as Record<string, unknown>) ?? {}
      const fieldData = (item.fieldData as Record<string, unknown>) ?? {}

      const attributes: Record<string, string[]> = {}
      for (const attr of attrs) {
        const key = String(attr.key)
        const value = String(attr.value)
        if (!attributes[key]) attributes[key] = []
        attributes[key].push(value)
      }

      return {
        itemNumber: item.itemNumber,
        title: desc.shortDescription ?? null,
        price: priceData.price ? Number.parseFloat(priceData.price) : null,
        listPrice: priceData.listPrice && priceData.listPrice !== '-1.00000'
          ? Number.parseFloat(priceData.listPrice)
          : null,
        brand: attributes.Brand?.[0] ?? (fieldData.mfName !== 'DO NOT DELETE' ? fieldData.mfName : null) ?? null,
        rating: additionalData.rating != null ? Number(additionalData.rating) : null,
        buyable: item.buyable === 1,
      }
    }),
    totalCount: catalogData.length,
  }
}

/* ---------- browse category ---------- */

async function browseCategory(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const category = String(params.category ?? '')
  if (!category) throw errors.missingParam('category')
  const pageSize = Number(params.pageSize ?? 24)
  const offset = Number(params.offset ?? 0)

  const body = {
    visitorId: '0',
    query: '',
    pageSize,
    offset,
    orderBy: null,
    searchMode: 'page',
    personalizationEnabled: false,
    warehouseId: '249-wh',
    shipToPostal: '95050',
    shipToState: 'CA',
    deliveryLocations: ['653-bd', '848-bd', '249-wh', '847_0-wm'],
    filterBy: [],
    pageCategories: [category],
    userInfo: { userId: '0' },
  }

  const resp = (await postJson(page, SEARCH_URL, body, errors, {
    'client-identifier': SEARCH_CLIENT_ID,
    client_id: 'USBC',
    locale: 'en-US',
    searchresultprovider: 'GRS',
  })) as Record<string, unknown>

  const searchResult = resp.searchResult as Record<string, unknown>
  const results = (searchResult?.results ?? []) as Array<Record<string, unknown>>

  const products = results.map((r) => {
    const product = r.product as Record<string, unknown>
    const attrs = (product?.attributes ?? {}) as Record<string, Record<string, unknown>>
    const primaryImage = (attrs.primary_image?.text as string[])?.[0] ?? null
    const pills = (attrs.pills?.text as string[]) ?? []
    const marketingStatement = (attrs.marketing_statement?.text as string[])?.[0] ?? null

    return {
      itemNumber: r.id,
      title: product?.title,
      brands: product?.brands,
      categories: product?.categories,
      imageUrl: primaryImage,
      pills,
      marketingStatement,
    }
  })

  // Extract available facets/filters from response
  const facets = (searchResult?.facets ?? []) as Array<Record<string, unknown>>
  const availableFilters = facets.map((f) => ({
    name: f.name,
    count: (f.values as Array<unknown>)?.length ?? 0,
  }))

  return {
    category,
    totalCount: searchResult?.totalCount ?? results.length,
    products,
    availableFilters,
  }
}

/* ---------- delivery options ---------- */

async function getDeliveryOptions(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const itemNumber = String(params.itemNumber ?? '')
  if (!itemNumber) throw errors.missingParam('itemNumber')
  const zipCode = String(params.zipCode ?? '95050')

  // Use the product GraphQL with delivery fields
  const deliveryQuery = `query {
    products(
      itemNumbers: ["${itemNumber}"],
      clientId: "${PRODUCT_CLIENT_ID}",
      locale: "en-us",
      warehouseNumber: "847"
    ) {
      catalogData {
        itemNumber
        buyable
        programTypes
        priceData { price }
        description { shortDescription }
        additionalFieldData {
          membershipReqd
          maxItemOrderQty
        }
      }
    }
  }`

  const resp = (await postJson(page, PRODUCT_GRAPHQL_URL, { query: deliveryQuery }, errors, {
    'client-identifier': PRODUCT_CLIENT_ID,
    'costco.env': 'ecom',
    'costco.service': 'restProduct',
  })) as Record<string, unknown>

  const data = resp.data as Record<string, unknown>
  const products = data?.products as Record<string, unknown>
  const catalogData = (products?.catalogData as Array<Record<string, unknown>>) ?? []

  if (catalogData.length === 0) {
    return { itemNumber, available: false, options: [] }
  }

  const item = catalogData[0]
  const priceData = (item.priceData as Record<string, string>) ?? {}
  const additionalData = (item.additionalFieldData as Record<string, unknown>) ?? {}
  const desc = (item.description as Record<string, string>) ?? {}
  const programTypes = (item.programTypes as string[]) ?? []

  const options: Array<Record<string, unknown>> = []

  if (programTypes.includes('SHIPPING')) {
    options.push({
      type: 'shipping',
      label: 'Standard Shipping',
      zipCode,
      available: item.buyable === 1,
    })
  }
  if (programTypes.includes('BD')) {
    options.push({
      type: 'business_delivery',
      label: 'Business Delivery',
      zipCode,
      available: true,
    })
  }
  if (programTypes.includes('WH')) {
    options.push({
      type: 'warehouse_pickup',
      label: 'Warehouse Pickup',
      available: true,
    })
  }

  return {
    itemNumber,
    title: desc.shortDescription ?? null,
    price: priceData.price ? Number.parseFloat(priceData.price) : null,
    available: item.buyable === 1,
    membershipRequired: additionalData.membershipReqd === 'Y',
    maxQuantity: additionalData.maxItemOrderQty != null ? Number(additionalData.maxItemOrderQty) : null,
    options,
  }
}

/* ---------- warehouse details ---------- */

async function getWarehouseDetails(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const warehouseId = params.warehouseId != null ? String(params.warehouseId) : null
  if (!warehouseId) throw errors.missingParam('warehouseId')

  // Navigate to warehouse detail page (JSON-LD has structured data)
  const warehouseUrl = `https://www.costco.com/w/-/${warehouseId}`
  await page.goto(warehouseUrl, { waitUntil: 'domcontentloaded' })

  const jsonLd = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] === 'LocalBusiness') return data
      } catch { /* skip invalid JSON-LD */ }
    }
    return null
  })

  if (!jsonLd) {
    return { warehouse: null }
  }

  const address = jsonLd.address ?? {}
  const geo = jsonLd.geo ?? {}
  const departments = (jsonLd.department ?? []) as Array<Record<string, unknown>>

  // Format opening hours from schema.org format
  const formatSchemaHours = (specs: Array<Record<string, unknown>>): string | null => {
    if (!specs?.length) return null
    return specs
      .filter((s: Record<string, unknown>) => s.opens && s.closes && s['@type'] === 'OpeningHoursSpecification')
      .map((s: Record<string, unknown>) => {
        const days = (s.dayOfWeek as string[]) ?? []
        const label = days.join(', ')
        return `${label}: ${s.opens} - ${s.closes}`
      })
      .join('; ') || null
  }

  const warehouseHours = formatSchemaHours(
    (jsonLd.openingHoursSpecification ?? []).filter((s: Record<string, unknown>) => s['@type']),
  )

  const services: Array<Record<string, unknown>> = departments.map((dept) => {
    const deptType = String(dept['@type'] ?? '')
    const code = deptType === 'GasStation' ? 'gas'
      : deptType === 'Pharmacy' ? 'pharmacy'
      : deptType === 'AutomotiveBusiness' ? 'auto'
      : deptType === 'FastFoodRestaurant' ? 'food-court'
      : deptType === 'Optician' ? 'optical'
      : deptType === 'MedicalBusiness' ? 'hearing-aids'
      : String(dept.name ?? '').toLowerCase().replace(/\s+/g, '-')
    return {
      name: dept.name ?? null,
      code,
      hours: formatSchemaHours((dept.openingHoursSpecification as Array<Record<string, unknown>>) ?? []),
      phone: dept.telephone ?? null,
    }
  })

  return {
    warehouse: {
      warehouseId,
      name: String(jsonLd.name ?? '').replace(/ \| Costco$/, '').replace(/, [A-Z]{2} Warehouse$/, ''),
      phone: jsonLd.telephone ?? null,
      address: {
        street: address.streetAddress ?? null,
        city: address.addressLocality ?? null,
        state: address.addressRegion ?? null,
        zipCode: address.postalCode ?? null,
        country: address.addressCountry ?? null,
      },
      latitude: geo.latitude != null ? Number(geo.latitude) : null,
      longitude: geo.longitude != null ? Number(geo.longitude) : null,
      hours: warehouseHours,
      services,
      hasGasStation: departments.some((d) => d['@type'] === 'GasStation'),
      hasPharmacy: departments.some((d) => d['@type'] === 'Pharmacy'),
      hasTireCenter: departments.some((d) => d['@type'] === 'AutomotiveBusiness'),
      hasFoodCourt: departments.some((d) => d['@type'] === 'FastFoodRestaurant'),
    },
  }
}

/* ---------- check warehouse stock ---------- */

async function checkWarehouseStock(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const itemNumber = String(params.itemNumber ?? '')
  if (!itemNumber) throw errors.missingParam('itemNumber')
  const warehouseNumber = String(params.warehouseNumber ?? '847')

  const stockQuery = `query {
    products(
      itemNumbers: ["${itemNumber}"],
      clientId: "${PRODUCT_CLIENT_ID}",
      locale: "en-us",
      warehouseNumber: "${warehouseNumber}"
    ) {
      catalogData {
        itemNumber
        buyable
        programTypes
        priceData { price listPrice }
        description { shortDescription }
        additionalFieldData {
          membershipReqd
          maxItemOrderQty
        }
      }
    }
  }`

  const resp = (await postJson(page, PRODUCT_GRAPHQL_URL, { query: stockQuery }, errors, {
    'client-identifier': PRODUCT_CLIENT_ID,
    'costco.env': 'ecom',
    'costco.service': 'restProduct',
  })) as Record<string, unknown>

  const data = resp.data as Record<string, unknown>
  const products = data?.products as Record<string, unknown>
  const catalogData = (products?.catalogData as Array<Record<string, unknown>>) ?? []

  if (catalogData.length === 0) {
    return { itemNumber, warehouseNumber, available: false, product: null }
  }

  const item = catalogData[0]
  const priceData = (item.priceData as Record<string, string>) ?? {}
  const additionalData = (item.additionalFieldData as Record<string, unknown>) ?? {}
  const desc = (item.description as Record<string, string>) ?? {}
  const programTypes = (item.programTypes as string[]) ?? []

  return {
    itemNumber,
    warehouseNumber,
    available: item.buyable === 1,
    inWarehouse: programTypes.includes('WH'),
    onlineOnly: !programTypes.includes('WH') && programTypes.includes('SHIPPING'),
    product: {
      title: desc.shortDescription ?? null,
      price: priceData.price ? Number.parseFloat(priceData.price) : null,
      membershipRequired: additionalData.membershipReqd === 'Y',
      maxQuantity: additionalData.maxItemOrderQty != null ? Number(additionalData.maxItemOrderQty) : null,
    },
  }
}

/* ---------- compare products ---------- */

async function compareProducts(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const itemNumbers = params.itemNumbers as string[] | undefined
  if (!itemNumbers?.length || itemNumbers.length < 2) {
    throw errors.missingParam('itemNumbers (at least 2)')
  }

  const quotedItems = itemNumbers.map((n) => `"${n}"`).join(', ')
  const query = PRODUCT_QUERY.replace('ITEM_NUMBERS', quotedItems)
  const resp = (await postJson(page, PRODUCT_GRAPHQL_URL, { query }, errors, {
    'client-identifier': PRODUCT_CLIENT_ID,
    'costco.env': 'ecom',
    'costco.service': 'restProduct',
  })) as Record<string, unknown>

  const data = resp.data as Record<string, unknown>
  const products = data?.products as Record<string, unknown>
  const catalogData = (products?.catalogData as Array<Record<string, unknown>>) ?? []

  return {
    products: catalogData.map((item) => {
      const attrs = (item.attributes as Array<Record<string, unknown>>) ?? []
      const desc = (item.description as Record<string, string>) ?? {}
      const priceData = (item.priceData as Record<string, string>) ?? {}
      const additionalData = (item.additionalFieldData as Record<string, unknown>) ?? {}
      const fieldData = (item.fieldData as Record<string, unknown>) ?? {}

      const attributes: Record<string, string[]> = {}
      for (const attr of attrs) {
        const key = String(attr.key)
        const value = String(attr.value)
        if (!attributes[key]) attributes[key] = []
        attributes[key].push(value)
      }

      return {
        itemNumber: item.itemNumber,
        title: desc.shortDescription ?? null,
        price: priceData.price ? Number.parseFloat(priceData.price) : null,
        listPrice: priceData.listPrice && priceData.listPrice !== '-1.00000'
          ? Number.parseFloat(priceData.listPrice)
          : null,
        brand: attributes.Brand?.[0] ?? (fieldData.mfName !== 'DO NOT DELETE' ? fieldData.mfName : null) ?? null,
        rating: additionalData.rating != null ? Number(additionalData.rating) : null,
        numberOfRatings: additionalData.numberOfRating != null ? Number(additionalData.numberOfRating) : null,
        buyable: item.buyable === 1,
        attributes,
      }
    }),
    comparedCount: catalogData.length,
  }
}

/* ---------- cart operations ---------- */

async function cartRequest(page: Page, queryParams: Record<string, string>, errors: Errors): Promise<unknown> {
  const qs = new URLSearchParams({
    ajaxFlag: 'true',
    ...queryParams,
  })

  const url = `${CART_URL}?${qs.toString()}`

  const resp = await page.request.fetch(url, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      Referer: 'https://www.costco.com/',
      'Content-Type': 'text/plain;charset=UTF-8',
    },
  })

  if (!resp.ok()) {
    throw errors.httpError(resp.status())
  }

  const text = await resp.text()
  try {
    return JSON.parse(text)
  } catch {
    return { success: resp.ok(), body: text.substring(0, 500) }
  }
}

async function addToCart(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const itemNumber = String(params.itemNumber ?? params.partNumber ?? '')
  if (!itemNumber) throw errors.missingParam('itemNumber')
  const quantity = Number(params.quantity ?? 1)

  return cartRequest(page, {
    checkOmsInventory: 'true',
    isPdpPage: 'true',
    isRestrictedPostalCode: 'false',
    partNumber: itemNumber,
    actionType: 'add',
    quantity: String(quantity),
    isShipRestrictionStore: 'true',
    productPartnumber: itemNumber,
    isFsaChdItem: 'false',
  }, errors)
}

async function removeFromCart(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const orderItemId = String(params.orderItemId ?? '')
  if (!orderItemId) throw errors.missingParam('orderItemId')

  return cartRequest(page, {
    orderItemId,
    actionType: 'remove',
    quantity: '0',
  }, errors)
}

async function updateCartQuantity(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const orderItemId = String(params.orderItemId ?? '')
  if (!orderItemId) throw errors.missingParam('orderItemId')
  const quantity = Number(params.quantity ?? 1)

  return cartRequest(page, {
    orderItemId,
    actionType: 'update',
    quantity: String(quantity),
  }, errors)
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>> = {
  searchProducts,
  searchSuggestions,
  getProductDetail,
  getMultipleProducts,
  getProductReviews,
  getDeliveryOptions,
  browseCategory,
  findWarehouses,
  getWarehouseDetails,
  checkWarehouseStock,
  compareProducts,
  addToCart,
  removeFromCart,
  updateCartQuantity,
}

const adapter: CustomRunner = {
  name: 'costco-api',
  description: 'Costco product search, detail, reviews, warehouses, delivery, and cart — via Playwright request',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers as unknown as { errors: Errors }
    try {
      const handler = OPERATIONS[operation]
      if (!handler) {
        throw errors.unknownOp(operation)
      }
      return await handler(page as Page, { ...params }, errors)
    } catch (error) {
      throw errors.wrap(error)
    }
  },
}

export default adapter

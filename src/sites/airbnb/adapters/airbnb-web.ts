import type { Page, Response as PwResponse } from 'patchright'
/**
 * Airbnb adapter — GraphQL interception + SSR extraction.
 *
 * Reviews and availability data are loaded via client-side GraphQL calls
 * (StaysPdpReviewsQuery, PdpAvailabilityCalendar), not embedded in the SSR
 * script tag. This adapter navigates to the listing page and intercepts
 * those GraphQL responses for the real data, falling back to SSR section
 * metadata when the GraphQL response is unavailable.
 */

/* ---------- helpers ---------- */

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

async function navigateAndWait(page: Page, url: string): Promise<void> {
	await page.goto(url, { waitUntil: 'load', timeout: 60000 })
	await page.waitForTimeout(3000)
}

/** Extract the presentation object from Airbnb's deferred state script tag. */
async function extractPresentation(page: Page): Promise<Record<string, unknown> | null> {
	return page.evaluate(() => {
		const el = document.querySelector('#data-deferred-state-0')
		if (!el?.textContent) return null
		try {
			const data = JSON.parse(el.textContent)
			const client = data?.niobeClientData
			if (!Array.isArray(client)) return null
			for (const entry of client) {
				const pres = entry?.[1]?.data?.presentation
				if (pres) return pres as Record<string, unknown>
			}
			return null
		} catch {
			return null
		}
	})
}

/** Find sections matching any of the given id substrings from the detail page data. */
function findSections(
	presentation: Record<string, unknown>,
	matchers: string[],
): Array<Record<string, unknown>> {
	const detail = presentation.stayProductDetailPage as Record<string, unknown> | undefined
	const sectionsObj = detail?.sections as Record<string, unknown> | undefined
	const sections = (sectionsObj?.sections ?? []) as Array<Record<string, unknown>>
	return sections.filter(s => {
		const sid = String(s.sectionId ?? '').toUpperCase()
		return matchers.some(m => sid.includes(m))
	})
}

/**
 * Intercept a GraphQL response by URL pattern while navigating.
 * Sets up listener before navigation, then waits for the response to arrive.
 */
async function interceptGraphQL(
	page: Page,
	urlPattern: string,
	navigateUrl: string,
	options?: { timeout?: number; scroll?: boolean },
): Promise<unknown> {
	const timeout = options?.timeout ?? 25000
	let captured: unknown = null

	const handler = async (resp: PwResponse) => {
		if (captured) return
		if (resp.url().includes(urlPattern)) {
			try { captured = await resp.json() } catch { /* ignore */ }
		}
	}
	page.on('response', handler)

	try {
		await page.goto(navigateUrl, { waitUntil: 'load', timeout: 60000 })
		// Reviews load after scroll; calendar loads on page init
		if (options?.scroll) {
			await page.waitForTimeout(2000)
			await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
			await page.waitForTimeout(1000)
			await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
		}
		const deadline = Date.now() + timeout
		while (!captured && Date.now() < deadline) {
			await wait(500)
		}
	} finally {
		page.off('response', handler)
	}

	return captured
}

/* ---------- operation handlers ---------- */

async function getListingReviews(page: Page, params: Record<string, unknown>): Promise<unknown> {
	const id = String(params.id ?? '')
	const url = `https://www.airbnb.com/rooms/${encodeURIComponent(id)}`

	// Intercept StaysPdpReviewsQuery — fired after page scroll
	const gqlResult = await interceptGraphQL(
		page, 'StaysPdpReviewsQuery', url, { scroll: true },
	) as Record<string, unknown> | null

	// Extract reviews from GraphQL response
	const pdp = (gqlResult?.data as Record<string, unknown>)
		?.presentation as Record<string, unknown>
	const detailPage = pdp?.stayProductDetailPage as Record<string, unknown>
	const reviewsObj = detailPage?.reviews as Record<string, unknown>

	if (reviewsObj) {
		const reviews = (reviewsObj.reviews ?? []) as Array<Record<string, unknown>>
		const metadata = reviewsObj.metadata as Record<string, unknown> | undefined
		return {
			listingId: id,
			reviews: reviews.map(r => ({
				id: r.id,
				comments: r.comments ?? r.commentV2,
				rating: r.rating,
				createdAt: r.createdAt,
				localizedDate: r.localizedDate,
				reviewer: r.reviewer,
				language: r.language,
				response: r.response,
				highlightType: r.highlightType,
				reviewHighlight: r.reviewHighlight,
			})),
			reviewsCount: metadata?.reviewsCount ?? reviews.length,
			// Include SSR rating metadata if available
			...(await extractReviewMetadata(page)),
		}
	}

	// Fallback: SSR section metadata only (no individual reviews)
	const presentation = await extractPresentation(page)
	if (!presentation) throw new Error('Failed to extract data from listing page')

	const reviewSections = findSections(presentation, ['REVIEW'])
	return {
		listingId: id,
		reviews: [],
		reviewsCount: 0,
		reviewSections: reviewSections.map(s => ({
			sectionId: s.sectionId,
			section: s.section,
		})),
	}
}

/** Extract review rating metadata from SSR data. */
async function extractReviewMetadata(page: Page): Promise<Record<string, unknown>> {
	const presentation = await extractPresentation(page)
	if (!presentation) return {}
	const sections = findSections(presentation, ['REVIEW'])
	const reviewSection = sections[0]?.section as Record<string, unknown> | undefined
	if (!reviewSection) return {}
	return {
		overallRating: reviewSection.overallRating ?? null,
		ratings: reviewSection.ratings ?? null,
	}
}

async function getListingAvailability(page: Page, params: Record<string, unknown>): Promise<unknown> {
	const id = String(params.id ?? '')
	const checkIn = String(params.check_in ?? '')
	const checkOut = String(params.check_out ?? '')

	let url = `https://www.airbnb.com/rooms/${encodeURIComponent(id)}`
	const qp = new URLSearchParams()
	if (checkIn) qp.set('check_in', checkIn)
	if (checkOut) qp.set('check_out', checkOut)
	const qs = qp.toString()
	if (qs) url += `?${qs}`

	// Intercept PdpAvailabilityCalendar — fired on initial page load
	const gqlResult = await interceptGraphQL(
		page, 'PdpAvailabilityCalendar', url,
	) as Record<string, unknown> | null

	// Extract calendar from GraphQL response: data.merlin.pdpAvailabilityCalendar
	const merlin = (gqlResult?.data as Record<string, unknown>)
		?.merlin as Record<string, unknown>
	const calendar = merlin?.pdpAvailabilityCalendar as Record<string, unknown>

	if (calendar) {
		const months = (calendar.calendarMonths ?? []) as Array<Record<string, unknown>>
		return {
			listingId: id,
			checkIn: checkIn || null,
			checkOut: checkOut || null,
			calendarMonths: months.map(m => ({
				month: m.month,
				year: m.year,
				days: (m.days as Array<Record<string, unknown>> ?? []).map(d => ({
					calendarDate: d.calendarDate,
					available: d.available,
					minNights: d.minNights,
					maxNights: d.maxNights,
					availableForCheckin: d.availableForCheckin,
					availableForCheckout: d.availableForCheckout,
					price: d.price,
				})),
			})),
		}
	}

	// Fallback: SSR section metadata
	const presentation = await extractPresentation(page)
	if (!presentation) throw new Error('Failed to extract data from listing page')

	const availSections = findSections(presentation, ['BOOK', 'AVAILABILITY', 'CALENDAR', 'PRICE', 'POLICIES'])
	return {
		listingId: id,
		checkIn: checkIn || null,
		checkOut: checkOut || null,
		calendarMonths: [],
		availabilitySections: availSections.map(s => ({
			sectionId: s.sectionId,
			section: s.section,
		})),
	}
}

/** Extract SSR data from any page using multiple strategies. */
async function extractPageData(page: Page): Promise<unknown> {
	return page.evaluate(() => {
		// Strategy 1: data-deferred-state tags (0, 1, 2, ...)
		for (let i = 0; i < 5; i++) {
			const el = document.querySelector(`#data-deferred-state-${i}`)
			if (el?.textContent) {
				try {
					return JSON.parse(el.textContent)
				} catch { /* continue */ }
			}
		}
		// Strategy 2: __NEXT_DATA__
		const nextData = document.querySelector('#__NEXT_DATA__')
		if (nextData?.textContent) {
			try {
				return JSON.parse(nextData.textContent)
			} catch { /* continue */ }
		}
		// Strategy 3: first application/json script with substantial content
		for (const script of document.querySelectorAll('script[type="application/json"]')) {
			const text = script.textContent ?? ''
			if (text.length > 200) {
				try {
					return JSON.parse(text)
				} catch { /* continue */ }
			}
		}
		return null
	})
}

async function getHostProfile(page: Page, params: Record<string, unknown>): Promise<unknown> {
	const hostId = String(params.hostId ?? '')
	const url = `https://www.airbnb.com/users/show/${encodeURIComponent(hostId)}`
	await navigateAndWait(page, url)

	// Try presentation-level extraction first
	const presentation = await extractPresentation(page)
	if (presentation) return { hostId, profile: presentation }

	// Fallback: extract raw SSR data using multiple strategies
	const raw = await extractPageData(page)
	if (raw) return { hostId, profile: raw }

	throw new Error('Failed to extract SSR data from host profile page')
}

/* ---------- dispatch ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
	getListingReviews,
	getListingAvailability,
	getHostProfile,
}

const adapter = {
	name: 'airbnb-web',
	description: 'Airbnb — reviews, availability, host profile via GraphQL interception + SSR',

	async init(page: Page): Promise<boolean> {
		return page.url().includes('airbnb.com')
	},

	async isAuthenticated(_page: Page): Promise<boolean> {
		return true
	},

	async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: Record<string, unknown>): Promise<unknown> {
		const { errors } = helpers as { errors: { unknownOp(op: string): Error; wrap(error: unknown): Error } }
		try {
			const handler = OPERATIONS[operation]
			if (!handler) throw errors.unknownOp(operation)
			return handler(page, { ...params })
		} catch (error) {
			throw errors.wrap(error)
		}
	},
}

export default adapter

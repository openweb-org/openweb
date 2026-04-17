import type { Page } from 'patchright'

import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner } from '../../../types/adapter.js'

type AdapterErrors = {
	botBlocked(msg: string): Error
	unknownOp(op: string): Error
	wrap(error: unknown): Error
}

const BASE = 'https://www.google.com'

/* ========== Shared: AF_initDataCallback parser ========== */

/** Parse all AF_initDataCallback entries from Google SSR HTML. */
function parseAfInitData(html: string): Map<string, unknown> {
	const results = new Map<string, unknown>()
	const regex = /AF_initDataCallback\(\{key:\s*'(ds:\d+)',\s*hash:\s*'\d+',\s*data:/g
	let match: RegExpExecArray | null
	for (match = regex.exec(html); match !== null; match = regex.exec(html)) {
		const key = match[1]
		const start = match.index + match[0].length
		let depth = 0
		let i = start
		let inStr = false
		let esc = false
		for (; i < html.length && i < start + 200_000; i++) {
			const ch = html[i]
			if (esc) { esc = false; continue }
			if (ch === '\\') { esc = true; continue }
			if (ch === '"') { inStr = !inStr; continue }
			if (inStr) continue
			if (ch === '[' || ch === '{') depth++
			else if (ch === ']' || ch === '}') { depth--; if (depth === 0) break }
		}
		const raw = html.slice(start, i + 1)
		try {
			results.set(key, JSON.parse(raw))
		} catch {
			// Trim trailing garbage for lenient parse
			let trimmed = raw
			while (trimmed.length > 0 && trimmed[trimmed.length - 1] !== ']') trimmed = trimmed.slice(0, -1)
			try { results.set(key, JSON.parse(trimmed)) } catch { /* skip unparseable */ }
		}
	}
	return results
}

/** Fetch Google Flights page HTML via node and return parsed ds:1 data. */
async function fetchFlightsData(
	tfs: string, errors: AdapterErrors,
): Promise<{ ds1: unknown[]; html: string }> {
	const url = new URL('/travel/flights/search', BASE)
	url.searchParams.set('tfs', tfs)
	const result = await nodeFetch({
		url: url.toString(),
		headers: { Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
		timeout: 25_000,
	})
	if (result.status !== 200) throw errors.botBlocked(`Google Flights returned HTTP ${result.status}`)
	const afData = parseAfInitData(result.text)
	const ds1 = afData.get('ds:1')
	if (!ds1 || !Array.isArray(ds1)) throw errors.wrap(new Error('Flight data (ds:1) not found in page'))
	return { ds1: ds1 as unknown[], html: result.text }
}

/* ========== Helpers ========== */

function fmtTime(t: unknown): string {
	if (!Array.isArray(t)) return ''
	const h = t[0] as number
	const m = (t[1] as number | undefined) ?? 0
	const ampm = h >= 12 ? 'PM' : 'AM'
	return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

function fmtDuration(mins: number): string {
	const h = Math.floor(mins / 60)
	const m = mins % 60
	if (h === 0) return `${m} min`
	if (m === 0) return `${h} hr`
	return `${h} hr ${m} min`
}

function extractOffer(offer: unknown[]): Record<string, unknown> | null {
	const d = offer[0] as unknown[]
	const priceArr = offer[1] as unknown[]
	if (!Array.isArray(d) || !Array.isArray(priceArr)) return null

	const legs = d[2] as unknown[][]
	const stopsCount = Array.isArray(legs) ? legs.length - 1 : 0

	// Emissions from d[22]
	const emStats = d[22] as unknown[] | null
	const emPct = Array.isArray(emStats) ? (emStats[3] as number | null) : null
	const co2g = Array.isArray(emStats) ? (emStats[7] as number | null) : null

	return {
		airline: Array.isArray(d[1]) ? (d[1] as string[])[0] : String(d[0]),
		airlineCode: d[0] as string,
		origin: d[3] as string,
		destination: d[6] as string,
		departureTime: fmtTime(d[5]),
		arrivalTime: fmtTime(d[8]),
		duration: fmtDuration(d[9] as number),
		durationMinutes: d[9] as number,
		stops: stopsCount === 0 ? 'Nonstop' : `${stopsCount} stop${stopsCount > 1 ? 's' : ''}`,
		price: Array.isArray(priceArr[0]) ? (priceArr[0] as unknown[])[1] as number : null,
		co2Kg: typeof co2g === 'number' ? Math.round(co2g / 1000) : null,
		emissionsPct: typeof emPct === 'number' ? emPct : null,
		legs: Array.isArray(legs)
			? legs.map((leg: unknown[]) => ({
					origin: leg[3] as string,
					originAirport: leg[4] as string,
					destination: leg[6] as string,
					destinationAirport: leg[5] as string,
					departureTime: fmtTime(leg[8]),
					arrivalTime: fmtTime(leg[10]),
					duration: fmtDuration(leg[11] as number),
					aircraft: leg[17] as string || '',
					flightNumber: Array.isArray(leg[22])
						? `${leg[22][0]}${leg[22][1]}`
						: '',
					airline: Array.isArray(leg[22]) ? (leg[22][3] as string) : '',
				}))
			: [],
	}
}

/* ========== Node operations ========== */

async function searchFlights(
	_page: Page | null, params: Record<string, unknown>, errors: AdapterErrors,
): Promise<unknown> {
	const tfs = String(params.tfs || '')
	if (!tfs) throw errors.wrap(new Error('tfs parameter is required'))

	const { ds1 } = await fetchFlightsData(tfs, errors)

	// Route info from ds1[1]
	const routeInfo = ds1[1] as unknown[][]
	const originCity = routeInfo?.[0]?.[0]?.[0]?.[1] as string || ''
	const originCode = (routeInfo?.[0]?.[0]?.[0]?.[2] as unknown[])?.[5] as string || ''
	const destCity = routeInfo?.[0]?.[1]?.[0]?.[1] as string ||
		routeInfo?.[1]?.[0]?.[0]?.[1] as string || ''
	const destCode = (routeInfo?.[0]?.[1]?.[0]?.[2] as unknown[])?.[5] as string ||
		(routeInfo?.[1]?.[0]?.[0]?.[2] as unknown[])?.[5] as string || ''

	// Best flights from ds1[2], other flights from ds1[3]
	const flights: Record<string, unknown>[] = []
	for (const bucket of [ds1[2], ds1[3]]) {
		const offers = Array.isArray(bucket) && Array.isArray(bucket[0]) ? bucket[0] as unknown[][] : []
		for (const offer of offers) {
			if (!Array.isArray(offer)) continue
			const f = extractOffer(offer)
			if (f) flights.push(f)
		}
	}

	return {
		origin: originCity ? `${originCity} (${originCode})` : originCode,
		destination: destCity ? `${destCity} (${destCode})` : destCode,
		resultCount: flights.length,
		flights,
	}
}

async function getPriceInsights(
	_page: Page | null, params: Record<string, unknown>, errors: AdapterErrors,
): Promise<unknown> {
	const tfs = String(params.tfs || '')
	if (!tfs) throw errors.wrap(new Error('tfs parameter is required'))

	const { ds1 } = await fetchFlightsData(tfs, errors)

	// Route info
	const routeInfo = ds1[1] as unknown[][]
	const origin = routeInfo?.[0]?.[0]?.[0]?.[1] as string || ''
	const destination = (ds1[5] as unknown[])?.[12] as string || ''

	// Price stats from ds1[5]
	const stats = ds1[5] as unknown[]
	const lowPrice = Array.isArray(stats?.[1]) ? (stats[1] as unknown[])[1] as number : null
	const typicalPrice = Array.isArray(stats?.[2]) ? (stats[2] as unknown[])[1] as number : null
	const lowRange = Array.isArray(stats?.[4]) ? (stats[4] as unknown[])[1] as number : null
	const highRange = Array.isArray(stats?.[5]) ? (stats[5] as unknown[])[1] as number : null

	// Price history from ds1[5][10]
	const historyData = stats?.[10]
	const priceHistory: Array<{ date: string; price: number }> = []
	if (Array.isArray(historyData) && Array.isArray(historyData[0])) {
		for (const [ts, price] of historyData[0] as [number, number][]) {
			const d = new Date(ts)
			priceHistory.push({
				date: d.toISOString().slice(0, 10),
				price,
			})
		}
	}

	// Filter metadata from ds1[7]
	const filters = ds1[7] as unknown[]
	const priceRange = {
		low: Array.isArray(filters?.[0]?.[0]) ? (filters[0] as unknown[][])[0][1] as number : null,
		high: Array.isArray(filters?.[0]?.[1]) ? (filters[0] as unknown[][])[1][1] as number : null,
	}
	const airlines: Array<{ code: string; name: string }> = []
	const airlineList = (filters?.[1] as unknown[])?.[1] as string[][] | undefined
	if (Array.isArray(airlineList)) {
		for (const [code, name] of airlineList) airlines.push({ code, name })
	}

	return {
		origin,
		destination,
		currentLowPrice: lowPrice,
		typicalPrice,
		priceRange: { low: lowRange, high: highRange },
		routePriceRange: priceRange,
		popularAirlines: airlines,
		priceHistory: priceHistory.length > 0 ? priceHistory : undefined,
	}
}

/* ========== Page operations (kept on page transport) ========== */

async function getFlightOverview(page: Page): Promise<unknown> {
	return page.evaluate(() => {
		const cards: Array<Record<string, unknown>> = []
		const text = document.body.innerText
		const priceBlocks = text.match(/Cheapest[\s\S]*?\$\d[\d,]*/g) || []
		for (const block of priceBlocks) {
			const priceMatch = block.match(/\$(\d[\d,]*)/)
			const airlineMatch = block.match(/\n([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\n/)
			const stopsMatch = block.match(/(Nonstop|\d+ stops?)/i)
			const durationMatch = block.match(/(\d+ hr(?: \d+ min)?)/)
			const dateMatch = block.match(
				/([A-Z][a-z]{2}, [A-Z][a-z]{2} \d+\s*[–—]\s*[A-Z][a-z]{2}, [A-Z][a-z]{2} \d+)/,
			)
			cards.push({
				price: priceMatch ? Number.parseInt(priceMatch[1].replace(',', '')) : null,
				airline: airlineMatch ? airlineMatch[1] : '',
				stops: stopsMatch ? stopsMatch[1] : '',
				duration: durationMatch ? durationMatch[1] : '',
				dates: dateMatch ? dateMatch[1] : '',
			})
		}
		const fastestMatch = text.match(/Fastest flight\s*(\d+ hr(?: \d+ min)?)/)
		const nonstopMatch = text.match(/Nonstop flights\s*(Every day|[A-Z][a-z]+)/)
		const origin =
			(document.querySelector('input[aria-label*="Where from"]') as HTMLInputElement)?.value || ''
		const dest =
			(document.querySelector('input[aria-label*="Where to"]') as HTMLInputElement)?.value || ''
		return {
			origin,
			destination: dest,
			cheapestOptions: cards,
			fastestFlight: fastestMatch ? fastestMatch[1] : '',
			nonstopFrequency: nonstopMatch ? nonstopMatch[1] : '',
		}
	})
}

async function getFlightBookingDetails(page: Page): Promise<unknown> {
	return page.evaluate(() => {
		const text = document.body.innerText
		const totalPriceMatch = text.match(/\$(\d[\d,]*)\s*(?:Lowest total price|round trip)/)
		const legs: Array<Record<string, unknown>> = []
		const legMatches = text.matchAll(
			/([A-Z][a-z]{2}, [A-Z][a-z]{2} \d+)\s*(\d+:\d+ [AP]M)\s*[–—]\s*(\d+:\d+ [AP]M)\s*([A-Za-z\s]+?)(?:Operated by ([^\n]+?))?\s*(\d+ hr(?: \d+ min)?)\s*([A-Z]{3})[–—]([A-Z]{3})\s*(Nonstop|\d+ stops?)/g,
		)
		for (const m of legMatches) {
			legs.push({
				date: m[1],
				departureTime: m[2],
				arrivalTime: m[3],
				airline: m[4]?.trim() || '',
				operatedBy: m[5]?.trim() || '',
				duration: m[6],
				origin: m[7],
				destination: m[8],
				stops: m[9],
			})
		}
		const bagPolicies: string[] = []
		const bagMatches = text.matchAll(
			/(free carry-on|carry-on bag available for a fee|checked bag[^.]*?\$\d+|checked bag available for a fee)/gi,
		)
		for (const m of bagMatches) bagPolicies.push(m[0])
		const bookingMatch = text.match(/Book with ([^\n]+)/)
		return {
			totalPrice: totalPriceMatch
				? Number.parseInt(totalPriceMatch[1].replace(',', ''))
				: null,
			legs,
			bagPolicies,
			bookWith: bookingMatch ? bookingMatch[1].trim() : '',
		}
	})
}

async function exploreDestinations(page: Page): Promise<unknown> {
	return page.evaluate(() => {
		const origin =
			(document.querySelector('input[aria-label*="Where from"]') as HTMLInputElement)?.value || ''
		const destinations: Array<Record<string, unknown>> = []
		const listItems = document.querySelectorAll('li')
		for (const li of listItems) {
			const text = li.textContent?.trim() || ''
			if (text.length > 200 || text.length < 10) continue
			if (!text.includes('$')) continue
			if (!/Nonstop|\d+\s*stop/i.test(text)) continue

			const parts = text.split('$')
			if (parts.length < 3) continue

			const beforePrice = parts[0]
			const flightPriceMatch = parts[1].match(/^(\d+)/)
			const hotelPriceMatch = parts[parts.length - 1].match(/^(\d+)/)
			if (!flightPriceMatch) continue

			const dateMatch = beforePrice.match(
				/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s*[–—]\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+)?\d+)/i,
			)
			const destination = dateMatch
				? beforePrice.slice(0, dateMatch.index).trim()
				: beforePrice.trim()
			const dates = dateMatch ? dateMatch[1].trim() : ''
			const middlePart = parts[1].replace(/^\d+/, '')
			const stopsMatch = middlePart.match(/(Nonstop|\d+\s*stops?)/i)
			const durationMatch = middlePart.match(/(\d+\s*hr(?:\s*\d+\s*min)?|\d+\s*min)/)

			destinations.push({
				destination,
				dates,
				flightPrice: Number.parseInt(flightPriceMatch[1]),
				stops: stopsMatch ? stopsMatch[1] : '',
				duration: durationMatch ? durationMatch[1].trim() : '',
				hotelPricePerNight: hotelPriceMatch
					? Number.parseInt(hotelPriceMatch[1])
					: null,
			})
		}
		return { origin, destinationCount: destinations.length, destinations }
	})
}

/* ========== Adapter export ========== */

/** Page ops need navigation paths */
const PAGE_OP_PATHS: Record<string, string> = {
	getFlightOverview: '/travel/flights',
	getFlightBookingDetails: '/travel/flights/booking',
	exploreDestinations: '/travel/explore',
}

const NODE_OPS: Record<
	string,
	(page: Page | null, params: Record<string, unknown>, errors: AdapterErrors) => Promise<unknown>
> = {
	searchFlights,
	getPriceInsights,
}

const PAGE_OPS: Record<string, (page: Page) => Promise<unknown>> = {
	getFlightOverview,
	getFlightBookingDetails,
	exploreDestinations,
}

const adapter: CustomRunner = {
	name: 'google-flights',
	description:
		'Google Flights — search + price insights via node SSR extraction, overview/booking/explore via page DOM',

	async run(ctx) {
		const { page, operation, params, helpers } = ctx
		const { errors } = helpers as unknown as { errors: AdapterErrors }

		// Node-transport operations
		const nodeHandler = NODE_OPS[operation]
		if (nodeHandler) return nodeHandler(page, { ...params }, errors)

		// Page-transport operations
		const pageHandler = PAGE_OPS[operation]
		if (!pageHandler) throw errors.unknownOp(operation)
		if (!page) throw errors.wrap(new Error(`${operation} requires page transport`))

		const basePath = PAGE_OP_PATHS[operation]
		if (basePath) {
			const url = new URL(basePath, BASE)
			if (params.tfs) url.searchParams.set('tfs', String(params.tfs))
			if (params.tfu) url.searchParams.set('tfu', String(params.tfu))
			await page.goto(url.toString(), { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
			await new Promise((r) => setTimeout(r, 3000))
		}

		return pageHandler(page)
	},
}

export default adapter

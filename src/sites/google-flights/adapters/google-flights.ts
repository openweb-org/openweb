import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
import type { CodeAdapter } from '../../../types/adapter.js'

/** Map operationId → Google Flights page path for navigation */
const OP_PATHS: Record<string, string> = {
	searchFlights: '/travel/flights/search',
	getFlightOverview: '/travel/flights',
	getFlightBookingDetails: '/travel/flights/booking',
	exploreDestinations: '/travel/explore',
	getPriceInsights: '/travel/flights/search/insights',
}

/* ---------- searchFlights ---------- */

async function searchFlights(page: Page): Promise<unknown> {
	return page.evaluate(() => {
		const flights: Array<Record<string, unknown>> = []
		const items = document.querySelectorAll('li.pIav2d')
		for (const li of items) {
			const text = li.textContent || ''
			if (!text.includes('$')) continue
			const timeMatch = text.match(
				/(\d+:\d+\s[AP]M)\d+:\d+\s[AP]M[\s\u00A0]+on[\s\u00A0]+.+?[\s\u00A0]+\u2013[\s\u00A0]+(\d+:\d+\s[AP]M)/,
			)
			if (!timeMatch) continue
			const airlineSpan = [...li.querySelectorAll('span')].find((s) => {
				const t = s.textContent?.trim()
				return (
					t.length > 2 &&
					t.length < 30 &&
					!t.match(/\d/) &&
					!t.includes('Airport') &&
					!t.includes('Nonstop') &&
					!t.includes('stop') &&
					!t.includes('emissions') &&
					!t.includes('trip') &&
					!t.includes('Select') &&
					!t.includes('Departure') &&
					!t.includes('Return')
				)
			})
			const airline = airlineSpan ? airlineSpan.textContent?.trim() : ''
			const durationMatch = text.match(/(\d+\shr(?:\s\d+\smin)?|\d+\smin)/)
			const routeMatch = text.match(/([A-Z]{3})[A-Za-z\s\u00A0-]+\u2013([A-Z]{3})/)
			const stopsText = text.match(/(Nonstop|\d+\sstops?)/i)
			const priceMatch = text.match(/\$(\d[\d,]*)/)
			const co2Match = text.match(/(\d+)\skg\sCO2/)
			const emMatch = text.match(/(-?\d+)%\semissions/)
			flights.push({
				departureTime: timeMatch[1],
				arrivalTime: timeMatch[2],
				airline,
				duration: durationMatch ? durationMatch[1] : '',
				origin: routeMatch ? routeMatch[1] : '',
				destination: routeMatch ? routeMatch[2] : '',
				stops: stopsText ? stopsText[1] : '',
				price: priceMatch ? Number.parseInt(priceMatch[1].replace(',', '')) : null,
				co2Kg: co2Match ? Number.parseInt(co2Match[1]) : null,
				emissionsPct: emMatch ? Number.parseInt(emMatch[1]) : null,
			})
		}
		const origin = (document.querySelector('input[aria-label*="Where from"]') as HTMLInputElement)?.value || ''
		const dest = (document.querySelector('input[aria-label*="Where to"]') as HTMLInputElement)?.value || ''
		const rc = document.body.innerText.match(/(\d+) results? returned/)
		return {
			origin,
			destination: dest,
			resultCount: rc ? Number.parseInt(rc[1]) : flights.length,
			flights,
		}
	})
}

/* ---------- getFlightOverview ---------- */

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
		const origin = (document.querySelector('input[aria-label*="Where from"]') as HTMLInputElement)?.value || ''
		const dest = (document.querySelector('input[aria-label*="Where to"]') as HTMLInputElement)?.value || ''
		return {
			origin,
			destination: dest,
			cheapestOptions: cards,
			fastestFlight: fastestMatch ? fastestMatch[1] : '',
			nonstopFrequency: nonstopMatch ? nonstopMatch[1] : '',
		}
	})
}

/* ---------- getFlightBookingDetails ---------- */

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
		for (const m of bagMatches) {
			bagPolicies.push(m[0])
		}
		const bookingMatch = text.match(/Book with ([^\n]+)/)
		return {
			totalPrice: totalPriceMatch ? Number.parseInt(totalPriceMatch[1].replace(',', '')) : null,
			legs,
			bagPolicies,
			bookWith: bookingMatch ? bookingMatch[1].trim() : '',
		}
	})
}

/* ---------- exploreDestinations ---------- */

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
			const destination = dateMatch ? beforePrice.slice(0, dateMatch.index).trim() : beforePrice.trim()
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
				hotelPricePerNight: hotelPriceMatch ? Number.parseInt(hotelPriceMatch[1]) : null,
			})
		}
		return { origin, destinationCount: destinations.length, destinations }
	})
}

/* ---------- getPriceInsights ---------- */

async function getPriceInsights(page: Page): Promise<unknown> {
	return page.evaluate(() => {
		const text = document.body.innerText
		const origin =
			(document.querySelector('input[aria-label*="Where from"]') as HTMLInputElement)?.value || ''
		const dest =
			(document.querySelector('input[aria-label*="Where to"]') as HTMLInputElement)?.value || ''

		// Price trend prediction (from search results page)
		const trendMatch = text.match(/Prices are (likely to go up[^\n]*|currently low|expected to[^\n]*|unlikely to[^\n]*)/)
		const priceTrend = trendMatch ? trendMatch[1].trim() : ''

		// Cheapest/most expensive months (from overview page)
		const cheapMonthMatch = text.match(/cheapest month to fly.*?is typically (\w+)/)
		const expMonthMatch = text.match(/most expensive month.*?is typically (\w+)/)
		const cheapRangeMatch = text.match(
			/(\w+)Cheapest\s*Typical prices:\s*\$(\d+)[–—](\d+)/,
		)
		const expRangeMatch = text.match(
			/(\w+)Most expensive\s*Typical prices:\s*\$(\d+)[–—](\d+)/,
		)

		// Popular airlines
		const airlines: Array<Record<string, unknown>> = []
		const airlineSection = text.match(/Popular airlines[^\n]*\n([\s\S]*?)(?:Popular airports|Frequently|$)/);
		if (airlineSection) {
			const airlineMatches = airlineSection[1].matchAll(
				/([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)*)\n(Nonstop|\d+\s*stops?)\nfrom\s*\$(\d+)/g,
			)
			for (const m of airlineMatches) {
				airlines.push({ airline: m[1].trim(), stops: m[2], fromPrice: Number.parseInt(m[3]) })
			}
		}

		return {
			origin,
			destination: dest,
			priceTrend,
			cheapestMonth: cheapMonthMatch ? cheapMonthMatch[1] : '',
			mostExpensiveMonth: expMonthMatch ? expMonthMatch[1] : '',
			cheapestRange: cheapRangeMatch
				? { low: Number.parseInt(cheapRangeMatch[2]), high: Number.parseInt(cheapRangeMatch[3]) }
				: null,
			mostExpensiveRange: expRangeMatch
				? { low: Number.parseInt(expRangeMatch[2]), high: Number.parseInt(expRangeMatch[3]) }
				: null,
			popularAirlines: airlines,
		}
	})
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page) => Promise<unknown>> = {
	searchFlights,
	getFlightOverview,
	getFlightBookingDetails,
	exploreDestinations,
	getPriceInsights,
}

const adapter: CodeAdapter = {
	name: 'google-flights',
	description: 'Google Flights — search, overview, booking, explore destinations, price insights via DOM extraction',

	async init(page: Page): Promise<boolean> {
		return page.url().includes('google.com')
	},

	async isAuthenticated(): Promise<boolean> {
		return true
	},

	async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
		try {
			const handler = OPERATIONS[operation]
			if (!handler) throw OpenWebError.unknownOp(operation)

			const basePath = OP_PATHS[operation]
			if (basePath) {
				const url = new URL(basePath, 'https://www.google.com')
				if (params.tfs) url.searchParams.set('tfs', String(params.tfs))
				if (params.tfu) url.searchParams.set('tfu', String(params.tfu))
				await page.goto(url.toString(), { waitUntil: 'load', timeout: 30000 })
				await new Promise((r) => setTimeout(r, 3000))
			}

			return await handler(page)
		} catch (error) {
			throw toOpenWebError(error)
		}
	},
}

export default adapter

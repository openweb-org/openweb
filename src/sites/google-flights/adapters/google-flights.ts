/**
 * Google Flights adapter — DOM extraction from search, overview, and booking pages.
 *
 * searchFlights:          Extract flight listings from /travel/flights/search
 * getFlightOverview:      Extract cheapest fares from /travel/flights route page
 * getFlightBookingDetails: Extract itinerary details from a booking detail page
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright'

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
				const t = s.textContent!.trim()
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
			const airline = airlineSpan ? airlineSpan.textContent!.trim() : ''
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
				price: priceMatch ? parseInt(priceMatch[1].replace(',', '')) : null,
				co2Kg: co2Match ? parseInt(co2Match[1]) : null,
				emissionsPct: emMatch ? parseInt(emMatch[1]) : null,
			})
		}
		const origin = (document.querySelector('input[aria-label*="Where from"]') as HTMLInputElement)?.value || ''
		const dest = (document.querySelector('input[aria-label*="Where to"]') as HTMLInputElement)?.value || ''
		const rc = document.body.innerText.match(/(\d+) results? returned/)
		return {
			origin,
			destination: dest,
			resultCount: rc ? parseInt(rc[1]) : flights.length,
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
				price: priceMatch ? parseInt(priceMatch[1].replace(',', '')) : null,
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
			totalPrice: totalPriceMatch ? parseInt(totalPriceMatch[1].replace(',', '')) : null,
			legs,
			bagPolicies,
			bookWith: bookingMatch ? bookingMatch[1].trim() : '',
		}
	})
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page) => Promise<unknown>> = {
	searchFlights,
	getFlightOverview,
	getFlightBookingDetails,
}

const adapter: CodeAdapter = {
	name: 'google-flights',
	description: 'Google Flights — search results, route overview, booking details via DOM extraction',

	async init(page: Page): Promise<boolean> {
		return page.url().includes('google.com/travel/flights')
	},

	async isAuthenticated(): Promise<boolean> {
		return true
	},

	async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
		const handler = OPERATIONS[operation]
		if (!handler) throw new Error(`Unknown operation: ${operation}`)
		return handler(page)
	},
}

export default adapter

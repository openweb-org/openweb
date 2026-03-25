import type { Page } from 'playwright-core'

/* ---------- Search Activities ---------- */

export async function searchActivities(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const text = document.body.innerText ?? ''
    const activities: {
      name: string
      duration: string | null
      rating: string | null
      price: string | null
      category: string | null
    }[] = []

    // Activity cards follow pattern: "第 N 位 NAME\n持续时间：...\nN.N\n$..."
    const sections = text.split(/第\s*\d+\s*位\s*/)
    for (const section of sections.slice(1, 31)) {
      const lines = section.split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length < 2) continue
      const name = lines[0]
      if (name.length > 150 || name.length < 3) continue

      const sectionText = section
      const durationMatch = sectionText.match(/(?:持续时间|Duration)[：:]\s*(.+?)(?:\n|$)/i)
      const ratingMatch = sectionText.match(/([\d.]+)\s*分/)
      const priceMatch = sectionText.match(/\$([\d,]+)/)

      activities.push({
        name,
        duration: durationMatch?.[1]?.trim() ?? null,
        rating: ratingMatch?.[1] ?? null,
        price: priceMatch ? `$${priceMatch[1]}` : null,
        category: null,
      })
    }

    // Total count from page text
    const totalMatch = text.match(/([\d,]+)\s*项旅游活动/)
    return {
      totalCount: totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) : activities.length,
      activities,
    }
  })
}

/* ---------- Search Car Rentals ---------- */

export async function searchCarRentals(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('[data-stid="car-offer-card"]')
    const cars: {
      name: string
      type: string | null
      passengers: string | null
      price: string | null
      provider: string | null
    }[] = []

    for (const card of cards) {
      const text = card.textContent?.trim() ?? ''
      const heading = card.querySelector('h3, h4, [class*="title"]')
      const name = heading?.textContent?.trim() ?? text.split('\n')[0]?.trim()
      if (!name || name.length > 120) continue

      const priceMatch = text.match(/\$([\d,]+)/)
      const passengerMatch = text.match(/(\d+)\s*(?:passengers|位乘客|人)/)

      cars.push({
        name,
        type: null,
        passengers: passengerMatch?.[1] ?? null,
        price: priceMatch ? `$${priceMatch[1]}` : null,
        provider: null,
      })
    }

    return { count: cars.length, cars: cars.slice(0, 30) }
  })
}

/* ---------- Get Deals ---------- */

export async function getDeals(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const deals: {
      name: string
      location: string | null
      rating: string | null
      price: string | null
      originalPrice: string | null
    }[] = []

    // Deal cards are in carousels with lodging-card-responsive or similar structure
    const cards = document.querySelectorAll('[data-stid="lodging-card-responsive"], [data-stid="carousel-item"]')
    for (const card of cards) {
      const heading = card.querySelector('h3, h4')
      const name = heading?.textContent?.trim()
      if (!name || name.length > 120) continue

      const text = card.textContent ?? ''
      const ratingMatch = text.match(/([\d.]+)\s*分/)
      const priceMatch = text.match(/\$([\d,]+)/)
      const origMatch = text.match(/\$(\d[\d,]+)\s*(?:总价含税费|total)/)

      // Location text
      const locEl = card.querySelector('p, [class*="subtitle"]')
      const location = locEl?.textContent?.trim() ?? null

      deals.push({
        name,
        location: location !== name ? location : null,
        rating: ratingMatch?.[1] ?? null,
        price: priceMatch ? `$${priceMatch[1]}` : null,
        originalPrice: origMatch ? `$${origMatch[1]}` : null,
      })
    }

    return { count: deals.length, deals: deals.slice(0, 30) }
  })
}

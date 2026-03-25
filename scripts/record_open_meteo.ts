/**
 * Scripted recording for Open-Meteo weather APIs.
 *
 * Captures: geocoding search, forecast, historical archive, air quality.
 * Run via: pnpm dev compile https://open-meteo.com --script scripts/record_open_meteo.ts
 */
import { parseArgs } from 'node:util'

import { chromium } from 'playwright'

import { createCaptureSession } from '../src/capture/session.js'

const { values } = parseArgs({
  options: { out: { type: 'string' } },
  strict: false,
})
const outputDir = values.out
if (!outputDir) {
  process.stderr.write('Usage: record_open_meteo.ts --out <dir>\n')
  process.exit(1)
}

const cdpPort = process.env.OPENWEB_CDP_PORT ?? '9222'
const cdpEndpoint = `http://localhost:${cdpPort}`

const browser = await chromium.connectOverCDP(cdpEndpoint)
const context = browser.contexts()[0]
if (!context) throw new Error('No browser context')

const page = await context.newPage()
const session = createCaptureSession({
  cdpEndpoint,
  outputDir,
  targetPage: page,
  isolateToTargetPage: true,
  onLog: (msg) => process.stderr.write(`${msg}\n`),
})
await session.ready

// 1. Geocoding search
await page.goto(
  'https://geocoding-api.open-meteo.com/v1/search?name=Berlin&count=1&language=en',
  { waitUntil: 'networkidle' },
)
await new Promise((r) => setTimeout(r, 500))

// 2. Weather forecast
await page.goto(
  'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&hourly=temperature_2m&daily=temperature_2m_max&timezone=auto',
  { waitUntil: 'networkidle' },
)
await new Promise((r) => setTimeout(r, 500))

// 3. Historical archive
await page.goto(
  'https://archive-api.open-meteo.com/v1/archive?latitude=52.52&longitude=13.41&start_date=2024-01-01&end_date=2024-01-02&daily=temperature_2m_max',
  { waitUntil: 'networkidle' },
)
await new Promise((r) => setTimeout(r, 500))

// 4. Air quality
await page.goto(
  'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=52.52&longitude=13.41&hourly=pm10&timezone=auto',
  { waitUntil: 'networkidle' },
)
await new Promise((r) => setTimeout(r, 500))

session.stop()
await session.done
await page.close()
await browser.close()

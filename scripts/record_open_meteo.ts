import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { chromium } from 'playwright'

interface Flow {
  readonly action: string
  readonly url: string
}

function parseArg(flag: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.findIndex((item) => item === flag)
  if (index < 0) {
    return undefined
  }
  return args[index + 1]
}

function appendParam(url: URL, name: string, value: string | number | readonly string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      url.searchParams.append(name, item)
    }
    return
  }

  url.searchParams.set(name, String(value))
}

function buildUrl(base: string, endpointPath: string, params: Record<string, string | number | readonly string[]>): string {
  const url = new URL(endpointPath, base)
  for (const [name, value] of Object.entries(params)) {
    appendParam(url, name, value)
  }
  return url.toString()
}

async function main(): Promise<void> {
  const outDirRaw = parseArg('--out')
  const outDir = outDirRaw ? path.resolve(outDirRaw) : path.resolve(process.cwd(), 'recording')
  await mkdir(outDir, { recursive: true })

  const flows: Flow[] = [
    {
      action: 'search_berlin',
      url: buildUrl('https://geocoding-api.open-meteo.com', '/v1/search', {
        name: 'Berlin',
        count: 1,
        language: 'en',
      }),
    },
    {
      action: 'search_tokyo',
      url: buildUrl('https://geocoding-api.open-meteo.com', '/v1/search', {
        name: 'Tokyo',
        count: 1,
      }),
    },
    {
      action: 'search_new_york',
      url: buildUrl('https://geocoding-api.open-meteo.com', '/v1/search', {
        name: 'New York',
      }),
    },
    {
      action: 'forecast_berlin',
      url: buildUrl('https://api.open-meteo.com', '/v1/forecast', {
        latitude: 52.52,
        longitude: 13.41,
        hourly: ['temperature_2m', 'precipitation'],
        daily: ['temperature_2m_max'],
        timezone: 'Europe/Berlin',
      }),
    },
    {
      action: 'forecast_tokyo_daily_only',
      url: buildUrl('https://api.open-meteo.com', '/v1/forecast', {
        latitude: 35.68,
        longitude: 139.69,
        daily: ['temperature_2m_min'],
        timezone: 'Asia/Tokyo',
      }),
    },
    {
      action: 'forecast_new_york_hourly_only',
      url: buildUrl('https://api.open-meteo.com', '/v1/forecast', {
        latitude: 40.71,
        longitude: -74.01,
        hourly: ['temperature_2m', 'wind_speed_10m'],
      }),
    },
    {
      action: 'archive_berlin',
      url: buildUrl('https://archive-api.open-meteo.com', '/v1/archive', {
        latitude: 52.52,
        longitude: 13.41,
        start_date: '2024-01-01',
        end_date: '2024-01-03',
        daily: ['temperature_2m_mean', 'precipitation_sum'],
      }),
    },
    {
      action: 'archive_tokyo',
      url: buildUrl('https://archive-api.open-meteo.com', '/v1/archive', {
        latitude: 35.68,
        longitude: 139.69,
        start_date: '2024-02-01',
        end_date: '2024-02-03',
      }),
    },
    {
      action: 'air_quality_berlin',
      url: buildUrl('https://air-quality-api.open-meteo.com', '/v1/air-quality', {
        latitude: 52.52,
        longitude: 13.41,
        hourly: ['pm10', 'pm2_5'],
        timezone: 'Europe/Berlin',
      }),
    },
    {
      action: 'air_quality_tokyo_no_optional',
      url: buildUrl('https://air-quality-api.open-meteo.com', '/v1/air-quality', {
        latitude: 35.68,
        longitude: 139.69,
      }),
    },
  ]

  const uiActions: string[] = []
  const harPath = path.join(outDir, 'traffic.har')

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    recordHar: {
      path: harPath,
      mode: 'full',
      content: 'embed',
    },
  })
  const page = await context.newPage()

  await page.goto('https://open-meteo.com', { waitUntil: 'domcontentloaded' })

  for (const flow of flows) {
    const timestamp = Date.now()
    const response = await page.goto(flow.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })

    uiActions.push(
      JSON.stringify({
        timestamp_ms: timestamp,
        action: flow.action,
        selector: null,
        value: null,
        url: flow.url,
        status: response?.status() ?? null,
      }),
    )
  }

  await context.close()
  await browser.close()

  const metadata = {
    recorded_at: new Date().toISOString(),
    mode: 'scripted_playwright',
    source: 'scripts/record_open_meteo.ts',
    flow_count: flows.length,
    har_path: harPath,
  }

  await writeFile(path.join(outDir, 'ui_actions.jsonl'), `${uiActions.join('\n')}\n`, 'utf8')
  await writeFile(path.join(outDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')

  process.stdout.write(`${JSON.stringify({ recording_dir: outDir })}\n`)
}

await main()

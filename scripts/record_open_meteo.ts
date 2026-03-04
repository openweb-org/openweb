import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

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

function requestHeaders(url: string): Array<{ name: string; value: string }> {
  const parsed = new URL(url)
  return [
    { name: 'accept', value: 'application/json' },
    { name: 'host', value: parsed.host },
  ]
}

async function executeFlow(flow: Flow): Promise<unknown> {
  const started = Date.now()
  const response = await fetch(flow.url, {
    headers: { accept: 'application/json' },
  })
  const body = await response.text()
  const elapsed = Date.now() - started

  const parsedUrl = new URL(flow.url)

  return {
    startedDateTime: new Date(started).toISOString(),
    time: elapsed,
    request: {
      method: 'GET',
      url: flow.url,
      headers: requestHeaders(flow.url),
      queryString: Array.from(parsedUrl.searchParams.entries()).map(([name, value]) => ({ name, value })),
    },
    response: {
      status: response.status,
      headers: [
        {
          name: 'content-type',
          value: response.headers.get('content-type') ?? '',
        },
      ],
      content: {
        mimeType: response.headers.get('content-type') ?? '',
        text: body,
      },
    },
  }
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
      action: 'forecast_tokyo',
      url: buildUrl('https://api.open-meteo.com', '/v1/forecast', {
        latitude: 35.68,
        longitude: 139.69,
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
      action: 'air_quality_tokyo',
      url: buildUrl('https://air-quality-api.open-meteo.com', '/v1/air-quality', {
        latitude: 35.68,
        longitude: 139.69,
        hourly: ['pm10'],
      }),
    },
  ]

  const entries: unknown[] = []
  const actionLines: string[] = []

  for (const flow of flows) {
    const timestamp = Date.now()
    const entry = await executeFlow(flow)
    entries.push(entry)

    actionLines.push(
      JSON.stringify({
        timestamp_ms: timestamp,
        action: flow.action,
        selector: null,
        value: null,
        url: flow.url,
      }),
    )
  }

  const har = {
    log: {
      version: '1.2',
      creator: {
        name: 'openweb-scripted-recorder',
        version: '0.1.0',
      },
      entries,
    },
  }

  const metadata = {
    recorded_at: new Date().toISOString(),
    mode: 'scripted',
    source: 'scripts/record_open_meteo.ts',
    flow_count: flows.length,
  }

  await writeFile(path.join(outDir, 'traffic.har'), `${JSON.stringify(har, null, 2)}\n`, 'utf8')
  await writeFile(path.join(outDir, 'ui_actions.jsonl'), `${actionLines.join('\n')}\n`, 'utf8')
  await writeFile(path.join(outDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')

  process.stdout.write(`${JSON.stringify({ recording_dir: outDir })}\n`)
}

await main()

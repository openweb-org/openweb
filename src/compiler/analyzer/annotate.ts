import type { ParameterDescriptor } from '../types.js'

interface Annotation {
  readonly operationId: string
  readonly summary: string
}

const KNOWN: Record<string, Annotation> = {
  'geocoding-api.open-meteo.com /v1/search': {
    operationId: 'search_location',
    summary: 'Search for a location by name (geocoding)',
  },
  'api.open-meteo.com /v1/forecast': {
    operationId: 'get_forecast',
    summary: 'Get hourly and daily weather forecast for a location',
  },
  'archive-api.open-meteo.com /v1/archive': {
    operationId: 'get_historical',
    summary: 'Get historical weather data for a location',
  },
  'air-quality-api.open-meteo.com /v1/air-quality': {
    operationId: 'get_air_quality',
    summary: 'Get air quality data for a location',
  },
}

const PARAM_DESCRIPTIONS: Record<string, string> = {
  latitude: 'Latitude in decimal degrees.',
  longitude: 'Longitude in decimal degrees.',
  hourly: 'Hourly variables to include in the response.',
  daily: 'Daily variables to include in the response.',
  timezone: 'IANA timezone identifier.',
  start_date: 'Start date in YYYY-MM-DD format.',
  end_date: 'End date in YYYY-MM-DD format.',
  name: 'Location name query.',
  count: 'Maximum number of matched results.',
  language: 'Language code for localized names.',
}

function mechanicalOperationId(path: string): string {
  const normalized = path
    .replace(/^\//, '')
    .replace(/\//g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '_')
  return `get_${normalized}`
}

export function annotateOperation(host: string, path: string): Annotation {
  const key = `${host} ${path}`
  const known = KNOWN[key]
  if (known) {
    return known
  }

  return {
    operationId: mechanicalOperationId(path),
    summary: `GET ${path}`,
  }
}

export function annotateParameterDescriptions(params: ParameterDescriptor[]): ParameterDescriptor[] {
  return params.map((parameter) => ({
    ...parameter,
    description: PARAM_DESCRIPTIONS[parameter.name] ?? parameter.description ?? '',
  }))
}

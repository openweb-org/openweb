import type { RecordedRequestSample } from '../types.js'

function isAllowedHost(host: string): boolean {
  return host.endsWith('open-meteo.com')
}

export function filterSamples(samples: RecordedRequestSample[]): RecordedRequestSample[] {
  return samples.filter((sample) => {
    if (sample.method !== 'GET') {
      return false
    }
    if (sample.status < 200 || sample.status >= 300) {
      return false
    }
    if (!isAllowedHost(sample.host)) {
      return false
    }
    if (sample.contentType && !sample.contentType.includes('application/json')) {
      return false
    }
    return true
  })
}

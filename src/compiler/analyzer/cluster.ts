import type { ClusteredEndpoint, RecordedRequestSample } from '../types.js'

export function clusterSamples(samples: RecordedRequestSample[]): ClusteredEndpoint[] {
  const groups = new Map<string, Map<string, Map<string, RecordedRequestSample[]>>>()

  for (const sample of samples) {
    if (!groups.has(sample.method)) {
      groups.set(sample.method, new Map())
    }
    const byHost = groups.get(sample.method)
    if (!byHost) {
      continue
    }
    if (!byHost.has(sample.host)) {
      byHost.set(sample.host, new Map())
    }
    const byPath = byHost.get(sample.host)
    if (!byPath) {
      continue
    }
    if (!byPath.has(sample.path)) {
      byPath.set(sample.path, [])
    }
    byPath.get(sample.path)?.push(sample)
  }

  const clustered: ClusteredEndpoint[] = []
  for (const [method, byHost] of groups.entries()) {
    for (const [host, byPath] of byHost.entries()) {
      for (const [apiPath, groupedSamples] of byPath.entries()) {
        clustered.push({
          method,
          host,
          path: apiPath,
          samples: groupedSamples,
        })
      }
    }
  }

  return clustered.sort((a, b) => `${a.host}${a.path}`.localeCompare(`${b.host}${b.path}`))
}

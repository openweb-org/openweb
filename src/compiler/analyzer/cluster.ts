import type { ClusteredEndpoint, RecordedRequestSample } from '../types.js'

function getOrCreate<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  let value = map.get(key)
  if (value === undefined) {
    value = factory()
    map.set(key, value)
  }
  return value
}

export function clusterSamples(samples: RecordedRequestSample[]): ClusteredEndpoint[] {
  const groups = new Map<string, Map<string, Map<string, RecordedRequestSample[]>>>()

  for (const sample of samples) {
    const byHost = getOrCreate(groups, sample.method, () => new Map())
    const byPath = getOrCreate(byHost, sample.host, () => new Map())
    getOrCreate(byPath, sample.path, () => []).push(sample)
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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadFailures, saveFailures, recordFailure, getFailuresForSite, getFailuresByClass, type FailureEntry } from './failures.js'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

const { readFile, writeFile, mkdir } = await import('node:fs/promises')

const sampleFailures: FailureEntry[] = [
  { site: 'github', operationId: 'getRepos', failureClass: 'schema_drift', detail: 'shape changed', timestamp: '2025-01-01T00:00:00Z' },
  { site: 'github', operationId: 'getIssues', failureClass: 'auth_drift', detail: 'auth expired', timestamp: '2025-01-02T00:00:00Z' },
  { site: 'reddit', operationId: 'getFeed', failureClass: 'schema_drift', detail: 'new field', timestamp: '2025-01-03T00:00:00Z' },
]

describe('failures knowledge base', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loadFailures returns empty array when file missing', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    const result = await loadFailures()
    expect(result).toEqual([])
  })

  it('loadFailures parses JSON file', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(sampleFailures))
    const result = await loadFailures()
    expect(result).toHaveLength(3)
  })

  it('saveFailures prunes to MAX_ENTRIES', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    // Create 600 entries
    const many = Array.from({ length: 600 }, (_, i) => ({
      site: 'test',
      operationId: `op-${i}`,
      failureClass: 'schema_drift',
      detail: 'test',
      timestamp: new Date().toISOString(),
    }))

    await saveFailures(many)

    const written = JSON.parse(vi.mocked(writeFile).mock.calls[0]![1] as string)
    expect(written).toHaveLength(500)
    // Should keep last 500 (most recent)
    expect(written[0].operationId).toBe('op-100')
  })

  it('recordFailure adds entry with timestamp', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify([]))
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await recordFailure({
      site: 'test',
      operationId: 'getFeed',
      failureClass: 'schema_drift',
      detail: 'shape changed',
    })

    const written = JSON.parse(vi.mocked(writeFile).mock.calls[0]![1] as string)
    expect(written).toHaveLength(1)
    expect(written[0].timestamp).toBeTruthy()
  })

  it('getFailuresForSite filters by site', () => {
    const result = getFailuresForSite(sampleFailures, 'github')
    expect(result).toHaveLength(2)
    expect(result.every((f) => f.site === 'github')).toBe(true)
  })

  it('getFailuresByClass filters by class', () => {
    const result = getFailuresByClass(sampleFailures, 'schema_drift')
    expect(result).toHaveLength(2)
    expect(result.every((f) => f.failureClass === 'schema_drift')).toBe(true)
  })
})

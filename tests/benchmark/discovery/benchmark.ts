#!/usr/bin/env tsx
/**
 * Discovery benchmark runner.
 *
 * Runs `openweb discover <url>` on 20 public API sites,
 * then verifies ≥1 GET operation returns 2xx.
 *
 * Requirements:
 *   - Managed Chrome running: `pnpm --silent dev browser start`
 *   - Run: `npx tsx tests/benchmark/discovery/benchmark.ts`
 *
 * Target: ≥70% success (≥14/20).
 */
import os from 'node:os'
import path from 'node:path'
import { readFile, rm } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'

import { discover } from '../../../src/discovery/pipeline.js'
import { benchmarkSites, type BenchmarkSite } from './sites.js'

interface BenchmarkResult {
  readonly site: string
  readonly url: string
  readonly success: boolean
  readonly operationCount: number
  readonly error?: string
  readonly durationMs: number
}

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? 'http://localhost:9222'
const DISCOVER_TIMEOUT = 90_000

async function runSingleBenchmark(site: BenchmarkSite): Promise<BenchmarkResult> {
  const start = Date.now()
  const outputDir = path.join(os.homedir(), '.openweb', 'benchmark', `${site.name}-fixture`)

  try {
    // Clean previous benchmark output
    await rm(outputDir, { recursive: true, force: true })

    // Run discovery
    const result = await Promise.race([
      discover({
        cdpEndpoint: CDP_ENDPOINT,
        targetUrl: site.url,
        outputDir,
        explore: true,
        captureDuration: 5000,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), DISCOVER_TIMEOUT),
      ),
    ])

    if (result.operationCount === 0) {
      return { site: site.name, url: site.url, success: false, operationCount: 0, error: 'no operations discovered', durationMs: Date.now() - start }
    }

    // Read generated spec and find first GET operation
    const specPath = path.join(outputDir, 'openapi.yaml')
    const specRaw = await readFile(specPath, 'utf8')
    const spec = parseYaml(specRaw) as { paths?: Record<string, Record<string, { operationId?: string }>> }

    let firstGetUrl: string | undefined
    for (const [apiPath, methods] of Object.entries(spec.paths ?? {})) {
      if (methods.get) {
        // Build URL from spec server + path
        const servers = (spec as { servers?: Array<{ url: string }> }).servers
        const baseUrl = servers?.[0]?.url ?? site.url
        firstGetUrl = `${baseUrl}${apiPath}`
        break
      }
    }

    if (!firstGetUrl) {
      return { site: site.name, url: site.url, success: false, operationCount: result.operationCount, error: 'no GET operation found', durationMs: Date.now() - start }
    }

    // Verify GET returns 2xx
    const controller = new AbortController()
    const fetchTimeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(firstGetUrl, { signal: controller.signal })
      clearTimeout(fetchTimeout)
      const success = response.status >= 200 && response.status < 300
      return {
        site: site.name,
        url: site.url,
        success,
        operationCount: result.operationCount,
        error: success ? undefined : `verify returned ${String(response.status)}`,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      clearTimeout(fetchTimeout)
      return { site: site.name, url: site.url, success: false, operationCount: result.operationCount, error: `verify failed: ${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - start }
    }
  } catch (err) {
    return { site: site.name, url: site.url, success: false, operationCount: 0, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
  }
}

async function main(): Promise<void> {
  console.log(`Discovery Benchmark — ${String(benchmarkSites.length)} sites`)
  console.log(`CDP: ${CDP_ENDPOINT}`)
  console.log('─'.repeat(70))

  const results: BenchmarkResult[] = []

  for (const site of benchmarkSites) {
    process.stdout.write(`  ${site.name.padEnd(20)} ... `)
    const result = await runSingleBenchmark(site)
    results.push(result)
    const status = result.success ? '✓' : '✗'
    const detail = result.error ? ` (${result.error})` : ''
    console.log(`${status} ${String(result.operationCount)} ops, ${String(Math.round(result.durationMs / 1000))}s${detail}`)
  }

  console.log('─'.repeat(70))

  const passed = results.filter((r) => r.success).length
  const total = results.length
  const rate = Math.round((passed / total) * 100)
  const target = Math.ceil(total * 0.7)

  console.log(`\nResults: ${String(passed)}/${String(total)} (${String(rate)}%)`)
  console.log(`Target:  ≥${String(target)}/${String(total)} (≥70%)`)
  console.log(`Status:  ${passed >= target ? 'PASS' : 'FAIL'}`)

  // Write results markdown
  const md = [
    '# Discovery Benchmark Results',
    '',
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `Success: ${String(passed)}/${String(total)} (${String(rate)}%)`,
    `Target: ≥70%`,
    `Status: ${passed >= target ? '**PASS**' : '**FAIL**'}`,
    '',
    '| Site | URL | Ops | Success | Duration | Error |',
    '|------|-----|-----|---------|----------|-------|',
    ...results.map((r) =>
      `| ${r.site} | ${r.url} | ${String(r.operationCount)} | ${r.success ? '✓' : '✗'} | ${String(Math.round(r.durationMs / 1000))}s | ${r.error ?? ''} |`,
    ),
  ].join('\n')

  const resultsPath = path.join(import.meta.dirname, 'results.md')
  const { writeFile: writeResultFile } = await import('node:fs/promises')
  await writeResultFile(resultsPath, md)
  console.log(`\nResults written to: ${resultsPath}`)

  process.exit(passed >= target ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

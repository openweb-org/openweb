import { discover, type DiscoverOptions } from '../discovery/pipeline.js'

export interface DiscoverCommandOptions {
  readonly url: string
  readonly cdpEndpoint: string
  readonly explore?: boolean
  readonly intent?: boolean
  readonly output?: string
  readonly duration?: number
}

export async function discoverCommand(opts: DiscoverCommandOptions): Promise<void> {
  const discoverOpts: DiscoverOptions = {
    cdpEndpoint: opts.cdpEndpoint,
    targetUrl: opts.url,
    explore: opts.explore ?? false,
    intent: opts.intent ?? false,
    outputDir: opts.output,
    captureDuration: opts.duration,
    onLog: (msg) => process.stdout.write(`${msg}\n`),
  }

  const result = await discover(discoverOpts)

  if (result.operationCount === 0) {
    process.stdout.write('\nNo operations discovered. Try browsing the site manually first.\n')
    return
  }

  process.stdout.write(
    `\nDiscovered ${String(result.operationCount)} operation(s) for ${result.site}.\n` +
      `Output: ${result.outputRoot}\n`,
  )

  if (result.intentCoverage) {
    process.stdout.write(
      `Intent coverage: ${String(result.intentCoverage.matched.length)} matched` +
        (result.intentCoverage.gaps.length > 0
          ? `, ${String(result.intentCoverage.gaps.length)} gaps (${result.intentCoverage.gaps.join(', ')})`
          : '') +
        '\n',
    )
  }
}

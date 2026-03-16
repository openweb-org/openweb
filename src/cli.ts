#!/usr/bin/env node
import process from 'node:process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { captureStartCommand, captureStopCommand } from './commands/capture.js'
import { compileCommand } from './commands/compile.js'
import { execCommand } from './commands/exec.js'
import { showCommand } from './commands/show.js'
import { sitesCommand } from './commands/sites.js'
import { testCommand } from './commands/test.js'
import { toOpenWebError, writeErrorToStderr } from './lib/errors.js'

async function withErrorHandling(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const openWebError = toOpenWebError(error)
    writeErrorToStderr(openWebError.payload)
    process.exit(1)
  }
}

const argv = hideBin(process.argv)
const firstArg = argv[0] ?? ''

const passthroughTopLevel = new Set(['sites', 'compile', 'capture', '--help', '-h', '--version', '-v'])

if (argv.length > 0 && !passthroughTopLevel.has(firstArg)) {
  const [site, second, third, fourth] = argv

  await withErrorHandling(async () => {
    if (!site) {
      throw new Error('Missing site name')
    }

    if (second === 'exec') {
      if (!third) {
        throw new Error('Usage: openweb <site> exec <tool> [json-params] [--cdp-endpoint <url>]')
      }
      const cdpIdx = argv.indexOf('--cdp-endpoint')
      const cdpEndpoint = cdpIdx >= 0 ? argv[cdpIdx + 1] : undefined
      if (cdpIdx >= 0 && !cdpEndpoint) {
        throw new Error('--cdp-endpoint requires a value (e.g. http://localhost:9222)')
      }
      const paramsJson = fourth && !fourth.startsWith('--') ? fourth : undefined
      await execCommand(site, third, paramsJson, { cdpEndpoint })
      return
    }

    if (second === 'test') {
      await testCommand(site)
      return
    }

    const tool = second && !second.startsWith('-') ? second : undefined
    const full = argv.includes('--full') || argv.includes('-f')
    await showCommand(site, tool, full)
  })

  process.exit(0)
}

await yargs(argv)
  .scriptName('openweb')
  .strict()
  .command('sites', 'List available sites', {}, async () => {
    await withErrorHandling(async () => {
      await sitesCommand()
    })
  })
  .command(
    'compile <url>',
    'Compile a site into tools (MVP scaffold)',
    (cmd) =>
      cmd
        .positional('url', { type: 'string', demandOption: true })
        .option('script', { type: 'string', describe: 'Playwright script file path' })
        .option('interactive', { type: 'boolean', default: false, describe: 'Use interactive recording mode' }),
    async (args) => {
      await withErrorHandling(async () => {
        await compileCommand({
          url: String(args.url),
          script: args.script ? String(args.script) : undefined,
          interactive: Boolean(args.interactive),
        })
      })
    },
  )
  .command(
    'capture',
    'Capture browser traffic and state via CDP',
    (cmd) =>
      cmd
        .command(
          'start',
          'Start capturing (runs until Ctrl+C)',
          (sub) =>
            sub
              .option('cdp-endpoint', {
                type: 'string',
                demandOption: true,
                describe: 'Chrome DevTools Protocol endpoint (e.g. http://localhost:9222)',
              })
              .option('output', { type: 'string', describe: 'Output directory (default: ./capture)' }),
          async (args) => {
            await withErrorHandling(async () => {
              await captureStartCommand({
                cdpEndpoint: String(args['cdp-endpoint']),
                output: args.output ? String(args.output) : undefined,
              })
            })
          },
        )
        .command('stop', 'Stop an active capture session', {}, async () => {
          await withErrorHandling(async () => {
            await captureStopCommand()
          })
        })
        .demandCommand(1),
  )
  .demandCommand(1)
  .help()
  .parseAsync()

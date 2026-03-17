#!/usr/bin/env node
import process from 'node:process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { captureStartCommand, captureStopCommand } from './commands/capture.js'
import { compileCommand } from './commands/compile.js'
import { discoverCommand } from './commands/discover.js'
import { verifyCommand } from './commands/verify.js'
import { registryCommand, type RegistryAction } from './commands/registry.js'
import { execCommand } from './commands/exec.js'
import { showCommand } from './commands/show.js'
import { sitesCommand } from './commands/sites.js'
import { testCommand } from './commands/test.js'
import { browserStartCommand, browserStopCommand, browserRestartCommand, browserStatusCommand, loginCommand } from './commands/browser.js'
import { OpenWebError, toOpenWebError, writeErrorToStderr } from './lib/errors.js'

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

const passthroughTopLevel = new Set(['sites', 'compile', 'capture', 'discover', 'verify', 'registry', 'browser', 'login', '--help', '-h', '--version', '-v'])

if (argv.length > 0 && !passthroughTopLevel.has(firstArg)) {
  const [site, second, third, fourth] = argv

  await withErrorHandling(async () => {
    if (!site) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'INVALID_PARAMS',
        message: 'Missing site name.',
        action: 'Usage: openweb <site> [exec <tool> [json-params]] [--cdp-endpoint <url>] [--max-response <bytes>]',
        retriable: false,
        failureClass: 'fatal',
      })
    }

    if (second === 'exec') {
      if (!third) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'INVALID_PARAMS',
          message: 'Missing tool name.',
          action: `Run \`openweb ${site}\` to list available tools.`,
          retriable: false,
          failureClass: 'fatal',
        })
      }
      const cdpIdx = argv.indexOf('--cdp-endpoint')
      const cdpEndpoint = cdpIdx >= 0 ? argv[cdpIdx + 1] : undefined
      if (cdpIdx >= 0 && !cdpEndpoint) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'INVALID_PARAMS',
          message: '--cdp-endpoint requires a value.',
          action: 'Example: --cdp-endpoint http://localhost:9222',
          retriable: false,
          failureClass: 'fatal',
        })
      }
      const maxResponseIdx = argv.indexOf('--max-response')
      const maxResponseRaw = maxResponseIdx >= 0 ? argv[maxResponseIdx + 1] : undefined
      if (maxResponseIdx >= 0 && !maxResponseRaw) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'INVALID_PARAMS',
          message: '--max-response requires a value.',
          action: 'Example: --max-response 8192',
          retriable: false,
          failureClass: 'fatal',
        })
      }
      let maxResponse: number | undefined
      if (maxResponseRaw !== undefined) {
        const parsedMaxResponse = Number(maxResponseRaw)
        if (!Number.isInteger(parsedMaxResponse) || parsedMaxResponse < 2) {
          throw new OpenWebError({
            error: 'execution_failed',
            code: 'INVALID_PARAMS',
            message: '--max-response must be an integer of at least 2 bytes.',
            action: 'Example: --max-response 8192',
            retriable: false,
            failureClass: 'fatal',
          })
        }
        maxResponse = parsedMaxResponse
      }
      const outputIdx = argv.indexOf('--output')
      const outputRaw = outputIdx >= 0 ? argv[outputIdx + 1] : undefined
      const output = outputRaw === 'file' ? 'file' as const : undefined
      const paramsJson = fourth && !fourth.startsWith('--') ? fourth : undefined
      await execCommand(site, third, paramsJson, { cdpEndpoint, maxResponse, output })
      return
    }

    if (second === 'test') {
      await testCommand(site)
      return
    }

    const tool = second && !second.startsWith('-') ? second : undefined
    const full = argv.includes('--full') || argv.includes('-f')
    const json = argv.includes('--json')
    const example = argv.includes('--example')
    await showCommand(site, tool, { full, json, example })
  })

  process.exit(0)
}

await yargs(argv)
  .scriptName('openweb')
  .strict()
  .command('sites', 'List available sites', (cmd) => cmd.option('json', { type: 'boolean', default: false, describe: 'Output as JSON' }), async (args) => {
    await withErrorHandling(async () => {
      await sitesCommand({ json: Boolean(args.json) })
    })
  })
  .command(
    'compile <url>',
    'Compile a site into tools (MVP scaffold)',
    (cmd) =>
      cmd
        .positional('url', { type: 'string', demandOption: true })
        .option('script', { type: 'string', describe: 'Playwright script file path' })
        .option('interactive', { type: 'boolean', default: false, describe: 'Use interactive recording mode' })
        .option('probe', { type: 'boolean', default: false, describe: 'Probe operations to validate classify heuristics (requires managed browser)' })
        .option('cdp-endpoint', { type: 'string', default: 'http://localhost:9222', describe: 'CDP endpoint for --probe' }),
    async (args) => {
      await withErrorHandling(async () => {
        await compileCommand({
          url: String(args.url),
          script: args.script ? String(args.script) : undefined,
          interactive: Boolean(args.interactive),
          probe: Boolean(args.probe),
          cdpEndpoint: args['cdp-endpoint'] ? String(args['cdp-endpoint']) : undefined,
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
  .command(
    'discover <url>',
    'Discover API endpoints from a website and generate a fixture',
    (cmd) =>
      cmd
        .positional('url', { type: 'string', demandOption: true, describe: 'Target site URL' })
        .option('cdp-endpoint', {
          type: 'string',
          default: 'http://localhost:9222',
          describe: 'Chrome DevTools Protocol endpoint',
        })
        .option('explore', { type: 'boolean', default: false, describe: 'Enable active exploration (clicks nav links, fills search)' })
        .option('intent', { type: 'boolean', default: false, describe: 'Enable intent-driven discovery (page analysis + targeted exploration)' })
        .option('output', { type: 'string', describe: 'Output directory for generated fixture' })
        .option('duration', { type: 'number', default: 8000, describe: 'Capture duration in ms' }),
    async (args) => {
      await withErrorHandling(async () => {
        await discoverCommand({
          url: String(args.url),
          cdpEndpoint: String(args['cdp-endpoint']),
          explore: Boolean(args.explore),
          intent: Boolean(args.intent),
          output: args.output ? String(args.output) : undefined,
          duration: Number(args.duration),
        })
      })
    },
  )
  .command(
    'verify [site]',
    'Verify site(s) and detect drift',
    (cmd) =>
      cmd
        .positional('site', { type: 'string', describe: 'Site to verify (omit with --all for all sites)' })
        .option('all', { type: 'boolean', default: false, describe: 'Verify all sites' })
        .option('auto-heal', { type: 'boolean', default: false, describe: 'Auto-heal drifted read operations' })
        .option('report', {
          describe: 'Output drift report (json or markdown)',
          coerce: (val: string | boolean) => val === true ? 'json' : val,
        }),
    async (args) => {
      await withErrorHandling(async () => {
        await verifyCommand({
          site: args.site ? String(args.site) : undefined,
          all: Boolean(args.all),
          autoHeal: Boolean(args['auto-heal']),
          report: args.report as boolean | string | undefined,
        })
      })
    },
  )
  .command(
    'registry <action> [site]',
    'Manage the site registry (list, install, rollback, show)',
    (cmd) =>
      cmd
        .positional('action', {
          type: 'string',
          demandOption: true,
          choices: ['list', 'install', 'rollback', 'show'] as const,
          describe: 'Registry action',
        })
        .positional('site', { type: 'string', describe: 'Site name' }),
    async (args) => {
      await withErrorHandling(async () => {
        await registryCommand({
          action: String(args.action) as RegistryAction,
          site: args.site ? String(args.site) : undefined,
        })
      })
    },
  )
  .command(
    'browser <action>',
    'Manage Chrome browser for authenticated sites',
    (cmd) =>
      cmd
        .positional('action', {
          type: 'string',
          demandOption: true,
          choices: ['start', 'stop', 'restart', 'status'] as const,
          describe: 'Browser action',
        })
        .option('headless', { type: 'boolean', default: false, describe: 'Run headless' })
        .option('port', { type: 'number', default: 9222, describe: 'CDP port' }),
    async (args) => {
      await withErrorHandling(async () => {
        const action = String(args.action)
        const opts = { headless: Boolean(args.headless), port: Number(args.port) }
        if (action === 'start') await browserStartCommand(opts)
        else if (action === 'stop') await browserStopCommand()
        else if (action === 'restart') await browserRestartCommand(opts)
        else if (action === 'status') await browserStatusCommand()
      })
    },
  )
  .command(
    'login <site>',
    'Open site in default browser for login',
    (cmd) =>
      cmd.positional('site', { type: 'string', demandOption: true, describe: 'Site name' }),
    async (args) => {
      await withErrorHandling(async () => {
        await loginCommand(String(args.site))
      })
    },
  )
  .demandCommand(1)
  .help()
  .parseAsync()

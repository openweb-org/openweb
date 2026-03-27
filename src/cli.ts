#!/usr/bin/env node
import process from 'node:process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { captureStartCommand, captureStopCommand } from './commands/capture.js'
import { compileCommand } from './commands/compile.js'
import { verifyCommand } from './commands/verify.js'
import { registryCommand, type RegistryAction } from './commands/registry.js'
import { execCommand } from './commands/exec.js'
import { showCommand } from './commands/show.js'
import { sitesCommand } from './commands/sites.js'
import { testCommand } from './commands/test.js'
import { browserStartCommand, browserStopCommand, browserRestartCommand, browserStatusCommand, loginCommand } from './commands/browser.js'
import { CDP_PORT, CDP_ENDPOINT } from './lib/config.js'
import { initCommand } from './commands/init.js'
import { OpenWebError, toOpenWebError, writeErrorToStderr } from './lib/errors.js'

function isJsonObject(s: string): boolean {
  if (!s.trimStart().startsWith('{')) return false
  try { JSON.parse(s); return true } catch { return false } // intentional: JSON validation check
}

interface ExecOptions {
  cdpEndpoint?: string
  maxResponse?: number
  output?: 'file'
}

function parseExecOptions(args: string[]): ExecOptions {
  const cdpIdx = args.indexOf('--cdp-endpoint')
  const cdpEndpoint = cdpIdx >= 0 ? args[cdpIdx + 1] : undefined
  if (cdpIdx >= 0 && !cdpEndpoint) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'INVALID_PARAMS',
      message: '--cdp-endpoint requires a value.',
      action: `Example: --cdp-endpoint ${CDP_ENDPOINT}`,
      retriable: false,
      failureClass: 'fatal',
    })
  }
  const maxResponseIdx = args.indexOf('--max-response')
  const maxResponseRaw = maxResponseIdx >= 0 ? args[maxResponseIdx + 1] : undefined
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
    const parsed = Number(maxResponseRaw)
    if (!Number.isInteger(parsed) || parsed < 2) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'INVALID_PARAMS',
        message: '--max-response must be an integer of at least 2 bytes.',
        action: 'Example: --max-response 8192',
        retriable: false,
        failureClass: 'fatal',
      })
    }
    maxResponse = parsed
  }
  const outputIdx = args.indexOf('--output')
  const outputRaw = outputIdx >= 0 ? args[outputIdx + 1] : undefined
  const output = outputRaw === 'file' ? 'file' as const : undefined
  return { cdpEndpoint, maxResponse, output }
}

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

const passthroughTopLevel = new Set(['sites', 'compile', 'capture', 'verify', 'registry', 'browser', 'login', 'init', '--help', '-h', '--version', '-v'])

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
      const opts = parseExecOptions(argv)
      const paramsJson = fourth && !fourth.startsWith('--') ? fourth : undefined
      await execCommand(site, third, paramsJson, opts)
      return
    }

    if (second === 'test') {
      await testCommand(site)
      return
    }

    // Auto-exec: openweb <site> <op> '{"json"}' → exec mode
    // Only trigger on JSON objects/arrays, and not when show-mode flags are present
    const hasShowFlags = argv.includes('--json') || argv.includes('--example') || argv.includes('--full') || argv.includes('-f')
    const isAutoExec = !hasShowFlags
      && second && second !== 'exec' && !second.startsWith('-')
      && third && !third.startsWith('-') && isJsonObject(third)

    if (isAutoExec) {
      const opts = parseExecOptions(argv)
      await execCommand(site, second, third, opts)
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
        .option('capture-dir', { type: 'string', describe: 'Use existing capture bundle instead of recording' })
        .option('interactive', { type: 'boolean', default: false, describe: 'Use interactive recording mode' })
        .option('probe', { type: 'boolean', default: false, describe: 'Probe operations to validate classify heuristics (requires managed browser)' })
        .option('cdp-endpoint', { type: 'string', default: CDP_ENDPOINT, describe: 'CDP endpoint for --probe' })
        .option('curation', { type: 'string', describe: 'Path to a curation decisions JSON file' }),
    async (args) => {
      await withErrorHandling(async () => {
        await compileCommand({
          url: String(args.url),
          script: args.script ? String(args.script) : undefined,
          captureDir: args['capture-dir'] ? String(args['capture-dir']) : undefined,
          interactive: Boolean(args.interactive),
          probe: Boolean(args.probe),
          cdpEndpoint: args['cdp-endpoint'] ? String(args['cdp-endpoint']) : undefined,
          curation: args.curation ? String(args.curation) : undefined,
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
                describe: `Chrome DevTools Protocol endpoint (e.g. ${CDP_ENDPOINT})`,
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
    'verify [site]',
    'Verify site(s) and detect drift',
    (cmd) =>
      cmd
        .positional('site', { type: 'string', describe: 'Site to verify (omit with --all for all sites)' })
        .option('all', { type: 'boolean', default: false, describe: 'Verify all sites' })
        .option('report', {
          describe: 'Output drift report (json or markdown). Only valid with --all.',
          coerce: (val: string | boolean) => val === true ? 'json' : val,
        })
        .check((argv) => {
          if (argv.report && !argv.all) {
            throw new Error('--report requires --all')
          }
          return true
        }),
    async (args) => {
      await withErrorHandling(async () => {
        await verifyCommand({
          site: args.site ? String(args.site) : undefined,
          all: Boolean(args.all),
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
        .option('port', { type: 'number', default: Number(CDP_PORT), describe: 'CDP port' }),
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
  .command('init', 'Initialize ~/.openweb/sites/ with default site packages', {}, async () => {
    await withErrorHandling(async () => {
      await initCommand()
    })
  })
  .demandCommand(1)
  .help()
  .parseAsync()

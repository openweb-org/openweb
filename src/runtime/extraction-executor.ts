import type { Browser, Page } from 'patchright'

import { CDP_PORT } from '../lib/config.js'
import { OpenWebError } from '../lib/errors.js'
import type { OpenApiOperation, OpenApiSpec } from '../lib/spec-loader.js'
import { getServerUrl } from '../lib/spec-loader.js'
import type { ExtractionPrimitive } from '../types/primitives.js'
import type { ExecutorResult } from './executor-result.js'
import { detectPageBotBlock } from './bot-detect.js'
import { resolvePagePlan } from './operation-context.js'
import { acquirePage, interpolateEntryUrl } from './page-plan.js'
import { resolveHtmlSelector } from './primitives/html-selector.js'
import { resolvePageGlobalData } from './primitives/page-global-data.js'
import { resolveResponseCapture } from './primitives/response-capture.js'
import { resolveScriptJson } from './primitives/script-json.js'
import { resolveSsrNextData } from './primitives/ssr-next-data.js'
import type { BrowserHandle } from './primitives/types.js'
import { ensurePagePolyfills } from './page-polyfill.js'
import { buildTargetUrl, resolveAllParameters, substitutePath } from './request-builder.js'

export type { ExecutorResult }

function createExtractionNeedsPageError(targetPageUrl: string): OpenWebError {
  return new OpenWebError({
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
    message: `No open page matches ${targetPageUrl}`,
    action: `Open a tab to ${targetPageUrl} and retry.`,
    retriable: true,
    failureClass: 'needs_page',
  })
}

function resolvePageUrl(
  serverUrl: string,
  extraction: ExtractionPrimitive,
  pathTemplate: string | undefined,
  spec: OpenApiSpec,
  operation: OpenApiOperation,
  params: Record<string, unknown>,
): string {
  // Determine the raw URL path: prefer explicit page_url, fall back to operation path template
  const rawPath = ('page_url' in extraction ? extraction.page_url : undefined) ?? pathTemplate

  if (!rawPath) {
    return serverUrl
  }

  const allParams = resolveAllParameters(spec, operation)

  // Absolute URL form for page_url — substitute {param} tokens, merge query params,
  // bypass serverUrl. Lets response_capture target a different origin from the API server.
  if (/^https?:\/\//i.test(rawPath)) {
    const substituted = rawPath.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const v = params[name]
      if (v === undefined || v === null) return `{${name}}`
      return encodeURIComponent(String(v))
    })
    const url = new URL(substituted)
    for (const p of allParams.filter((x) => x.in === 'query')) {
      const value = params[p.name]
      if (value === undefined || value === null) continue
      if (url.searchParams.has(p.name)) continue
      url.searchParams.set(p.name, String(value))
    }
    return url.toString()
  }

  // Substitute path parameters (e.g., /dp/{asin} → /dp/B0D77BX616)
  const resolvedPath = substitutePath(rawPath, allParams, params)

  // Build full URL including query parameters
  return buildTargetUrl(serverUrl, resolvedPath, allParams, params)
}

function getExtraction(operation: OpenApiOperation): ExtractionPrimitive {
  const extraction = (operation['x-openweb'] as { extraction?: ExtractionPrimitive } | undefined)?.extraction
  if (!extraction) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'Operation does not define an extraction primitive.',
      action: 'Add x-openweb.extraction to the operation and retry.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return extraction
}

export async function executeExtraction(
  browser: Browser,
  spec: OpenApiSpec,
  operation: OpenApiOperation,
  pathTemplate?: string,
  params: Record<string, unknown> = {},
): Promise<ExecutorResult> {
  const context = browser.contexts()[0]
  if (!context) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No browser context available. Is Chrome open with the site loaded?',
      action: `Open Chrome with --remote-debugging-port=${CDP_PORT} and navigate to the site.`,
      retriable: true,
      failureClass: 'needs_browser',
    })
  }

  const hasServer = !!(operation.servers?.[0]?.url ?? spec.servers?.[0]?.url)
  if (!hasServer) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No server URL found in OpenAPI spec.',
      action: 'Add `servers` to the spec and retry.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
  const serverUrl = getServerUrl(spec, operation, params)

  const extraction = getExtraction(operation)
  const targetPageUrl = resolvePageUrl(serverUrl, extraction, pathTemplate, spec, operation, params)
  const planConfig = resolvePagePlan(spec, operation) ?? {}
  const isResponseCapture = extraction.type === 'response_capture'
  let page: Page
  let ownedPage: boolean
  try {
    const acquired = await acquirePage(context, serverUrl, {
      entry_url: isResponseCapture ? targetPageUrl : (interpolateEntryUrl(planConfig.entry_url, params) ?? targetPageUrl),
      ready: planConfig.ready,
      wait_until: planConfig.wait_until,
      settle_ms: planConfig.settle_ms,
      warm: planConfig.warm,
      nav_timeout_ms: planConfig.nav_timeout_ms,
      forceFresh: isResponseCapture,
    })
    page = acquired.page
    ownedPage = acquired.owned
  } catch (err) {
    if (err instanceof OpenWebError && err.payload.failureClass === 'needs_page') {
      throw createExtractionNeedsPageError(targetPageUrl)
    }
    throw err
  }

  try {
    await ensurePagePolyfills(page)
    const handle: BrowserHandle = { page, context }
    let body: unknown
    switch (extraction.type) {
      case 'script_json':
        body = await resolveScriptJson(handle, extraction)
        break
      case 'ssr_next_data':
        body = await resolveSsrNextData(handle, extraction)
        break
      case 'html_selector':
        body = await resolveHtmlSelector(handle, extraction)
        break
      case 'page_global_data':
        body = await resolvePageGlobalData(handle, extraction as { expression: string; path?: string })
        break
      case 'response_capture':
        body = await resolveResponseCapture(handle, extraction, {
          navigateUrl: targetPageUrl,
          navTimeoutMs: planConfig.nav_timeout_ms ?? 30_000,
          waitUntil: planConfig.wait_until,
        })
        break
      default: {
        const unreachable = extraction as { type: string }
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: `Unsupported extraction primitive: ${unreachable.type}`,
          action: 'Implement the extraction resolver or update the site package.',
          retriable: false,
          failureClass: 'fatal',
        })
      }
    }

    // Post-extraction bot detection: catch extraction from CAPTCHA/block pages
    const botSignal = await detectPageBotBlock(page)
    if (botSignal) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Bot detection on page: ${botSignal}`,
        action: 'Solve CAPTCHA in visible browser, then retry.',
        retriable: true,
        failureClass: 'bot_blocked',
      })
    }

    return {
      status: 200,
      body,
      responseHeaders: {},
    }
  } finally {
    if (ownedPage) await page.close().catch(() => {})
  }
}

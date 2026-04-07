import type { Browser, BrowserContext, Page } from 'patchright'

import { CDP_PORT } from '../lib/config.js'
import { OpenWebError } from '../lib/errors.js'
import type { OpenApiOperation, OpenApiSpec } from '../lib/openapi.js'
import type { ExtractionPrimitive } from '../types/primitives.js'
import type { ExecutorResult } from './executor-result.js'
import { listCandidatePages } from './page-candidates.js'
import { resolveHtmlSelector } from './primitives/html-selector.js'
import { resolvePageGlobalData } from './primitives/page-global-data.js'
import { resolveScriptJson } from './primitives/script-json.js'
import { resolveSsrNextData } from './primitives/ssr-next-data.js'
import type { BrowserHandle } from './primitives/types.js'
import { ensurePagePolyfills } from './page-polyfill.js'
import { buildTargetUrl, resolveAllParameters, substitutePath } from './request-builder.js'
import { type AutoNavigateResult, autoNavigate, findPageForOrigin } from './session-executor.js'

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

async function findPageForTarget(
  context: BrowserContext,
  targetUrl: string,
  requireExactPath: boolean,
): Promise<Page | undefined> {
  const pages = await listCandidatePages(context)
  try {
    const target = new URL(targetUrl)
    for (const page of pages) {
      try {
        const current = new URL(page.url())
        if (current.origin === target.origin
          && decodeURIComponent(current.pathname) === decodeURIComponent(target.pathname)) {
          return page
        }
      } catch {
        // intentional: detached pages and about:blank URLs fail URL parse
      }
    }

    if (requireExactPath) {
      return undefined
    }
  } catch {
    // intentional: malformed targetUrl — fall through to origin-level matching
  }

  return findPageForOrigin(context, targetUrl)
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

  // Substitute path parameters (e.g., /dp/{asin} → /dp/B0D77BX616)
  const allParams = resolveAllParameters(spec, operation)
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

  const serverUrl = operation.servers?.[0]?.url ?? spec.servers?.[0]?.url
  if (!serverUrl) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No server URL found in OpenAPI spec.',
      action: 'Add `servers` to the spec and retry.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const extraction = getExtraction(operation)
  const targetPageUrl = resolvePageUrl(serverUrl, extraction, pathTemplate, spec, operation, params)
  let page = await findPageForTarget(context, targetPageUrl, 'page_url' in extraction && !!extraction.page_url)
  let ownedPage = false
  if (!page) {
    // Navigate directly to the target URL (includes path + query params)
    try {
      const newPage = await context.newPage()
      await newPage.goto(targetPageUrl, { waitUntil: 'load', timeout: 30_000 })
      page = newPage
      ownedPage = true
    } catch {
      // Fallback: auto-navigate to server homepage
      const nav = await autoNavigate(context, serverUrl)
      if (nav) { page = nav.page; ownedPage = nav.owned }
    }
  }
  if (!page) {
    throw createExtractionNeedsPageError(targetPageUrl)
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
        body = await resolvePageGlobalData(handle, extraction)
        break
      default:
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: `Unsupported extraction primitive: ${extraction.type}`,
          action: 'Implement the extraction resolver or update the site package.',
          retriable: false,
          failureClass: 'fatal',
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

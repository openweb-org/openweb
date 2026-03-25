import type { Browser, BrowserContext, Page } from 'playwright-core'

import { OpenWebError } from '../lib/errors.js'
import type { OpenApiOperation, OpenApiSpec } from '../lib/openapi.js'
import type { ExtractionPrimitive } from '../types/primitives.js'
import { resolveHtmlSelector } from './primitives/html-selector.js'
import { resolvePageGlobalData } from './primitives/page-global-data.js'
import { resolveScriptJson } from './primitives/script-json.js'
import { resolveSsrNextData } from './primitives/ssr-next-data.js'
import type { BrowserHandle } from './primitives/types.js'
import { listCandidatePages } from './page-candidates.js'
import { findPageForOrigin } from './session-executor.js'

export interface ExtractionResult {
  readonly status: number
  readonly body: unknown
  readonly responseHeaders: Readonly<Record<string, string>>
}

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
        if (current.origin === target.origin && current.pathname === target.pathname) {
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

function resolvePageUrl(serverUrl: string, extraction: ExtractionPrimitive): string {
  const pageUrl = 'page_url' in extraction ? extraction.page_url : undefined
  if (!pageUrl) {
    return serverUrl
  }

  try {
    return new URL(pageUrl, serverUrl).toString()
  } catch {
    // intentional: relative URL resolution failed — use page_url as-is
    return pageUrl
  }
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
): Promise<ExtractionResult> {
  const context = browser.contexts()[0]
  if (!context) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No browser context available. Is Chrome open with the site loaded?',
      action: 'Open Chrome with --remote-debugging-port=9222 and navigate to the site.',
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
  const targetPageUrl = resolvePageUrl(serverUrl, extraction)
  const page = await findPageForTarget(context, targetPageUrl, 'page_url' in extraction && !!extraction.page_url)
  if (!page) {
    throw createExtractionNeedsPageError(targetPageUrl)
  }

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
        action: 'Implement the extraction resolver or update the fixture.',
        retriable: false,
        failureClass: 'fatal',
      })
  }

  return {
    status: 200,
    body,
    responseHeaders: {},
  }
}

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import Ajv from 'ajv'

import { OpenWebError } from '../lib/errors.js'
import {
  buildQueryUrl,
  findOperation,
  getResponseSchema,
  getServerUrl,
  loadOpenApi,
  resolveSiteRoot,
} from '../lib/openapi.js'
import { validateSSRF } from '../lib/ssrf.js'

const MAX_REDIRECTS = 5

export interface ExecuteDependencies {
  readonly fetchImpl?: typeof fetch
  readonly ssrfValidator?: (url: string) => Promise<void>
}

export interface ExecuteResult {
  readonly status: number
  readonly body: unknown
  readonly responseSchemaValid: boolean
}

function isRedirect(statusCode: number): boolean {
  return statusCode >= 300 && statusCode < 400
}

export async function fetchWithValidatedRedirects(
  inputUrl: string,
  method: string,
  deps: ExecuteDependencies,
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const ssrfValidator = deps.ssrfValidator ?? validateSSRF

  let current = inputUrl

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    await ssrfValidator(current)

    const response = await fetchImpl(current, {
      method,
      headers: {
        Accept: 'application/json',
      },
      redirect: 'manual',
    })

    if (!isRedirect(response.status)) {
      return response
    }

    const location = response.headers.get('location')
    if (!location) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: 'Redirect response missing Location header.',
        action: 'Retry or inspect upstream endpoint behavior.',
        retriable: true,
      })
    }

    current = new URL(location, current).toString()
  }

  throw new OpenWebError({
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
    message: `Too many redirects (>${MAX_REDIRECTS})`,
    action: 'Retry later or inspect endpoint redirects.',
    retriable: true,
  })
}

export async function executeOperation(
  site: string,
  operationId: string,
  params: Record<string, unknown>,
  deps: ExecuteDependencies = {},
): Promise<ExecuteResult> {
  const spec = await loadOpenApi(site)
  const operationRef = findOperation(spec, operationId)
  const serverUrl = getServerUrl(spec, operationRef.operation)
  const url = buildQueryUrl(serverUrl, operationRef.path, operationRef.operation.parameters, params)

  const response = await fetchWithValidatedRedirects(url, operationRef.method.toUpperCase(), deps)

  if (!response.ok) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `HTTP ${response.status}`,
      action: `Check parameters with: openweb ${site} ${operationId}`,
      retriable: response.status === 429 || response.status >= 500,
    })
  }

  const body = (await response.json()) as unknown
  const schema = getResponseSchema(operationRef.operation)

  let responseSchemaValid = true
  if (schema) {
    const ajv = new Ajv({ strict: false, allErrors: true })
    const validate = ajv.compile(schema)
    responseSchemaValid = validate(body)
    if (!responseSchemaValid) {
      process.stderr.write(
        `warning: response schema mismatch for ${site}/${operationId}: ${ajv.errorsText(validate.errors)}\n`,
      )
    }
  }

  return {
    status: response.status,
    body,
    responseSchemaValid,
  }
}

interface TestCase {
  readonly input: Record<string, unknown>
  readonly assertions: {
    readonly status: number
    readonly response_schema_valid: boolean
  }
}

interface TestFile {
  readonly operation_id: string
  readonly cases: TestCase[]
}

export async function runSiteTests(site: string): Promise<{ passed: number; failed: number }> {
  const siteRoot = await resolveSiteRoot(site)
  const testsDir = path.join(siteRoot, 'tests')

  let files: string[]
  try {
    files = await readdir(testsDir)
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'TOOL_NOT_FOUND',
      message: `No tests found for site: ${site}`,
      action: 'Generate tests or use a site fixture that contains tests/*.test.json.',
      retriable: false,
    })
  }

  let passed = 0
  let failed = 0

  for (const fileName of files) {
    if (!fileName.endsWith('.test.json')) {
      continue
    }

    const raw = await readFile(path.join(testsDir, fileName), 'utf8')
    const testFile = JSON.parse(raw) as TestFile

    for (const testCase of testFile.cases) {
      try {
        const result = await executeOperation(site, testFile.operation_id, testCase.input)
        const statusPass = result.status === testCase.assertions.status
        const schemaPass = result.responseSchemaValid === testCase.assertions.response_schema_valid

        if (statusPass && schemaPass) {
          passed += 1
        } else {
          failed += 1
          process.stderr.write(
            `FAIL ${testFile.operation_id} (${fileName}): expected status=${testCase.assertions.status}, schema=${testCase.assertions.response_schema_valid}; got status=${result.status}, schema=${result.responseSchemaValid}\n`,
          )
        }
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        process.stderr.write(`FAIL ${testFile.operation_id} (${fileName}): ${message}\n`)
      }
    }
  }

  return { passed, failed }
}

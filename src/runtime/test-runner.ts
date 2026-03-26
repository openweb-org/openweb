import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { OpenWebError } from '../lib/errors.js'
import { resolveSiteRoot } from '../lib/openapi.js'
import { executeOperation } from './http-executor.js'

interface TestCase {
  readonly input: Record<string, unknown>
  readonly assertions: {
    readonly status: number
    readonly response_schema_valid?: boolean
  }
}

interface TestFile {
  readonly operation_id: string
  readonly method?: string
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
      action: 'Generate tests or use a site package that contains tests/*.test.json.',
      retriable: false,
      failureClass: 'fatal',
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

    // Skip non-GET operations — mutations are not safe to replay
    if (testFile.method && testFile.method !== 'get') {
      continue
    }

    for (const testCase of testFile.cases) {
      try {
        const result = await executeOperation(site, testFile.operation_id, testCase.input)
        const statusPass = result.status === testCase.assertions.status
        const schemaPass = testCase.assertions.response_schema_valid === undefined
          || result.responseSchemaValid === testCase.assertions.response_schema_valid

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

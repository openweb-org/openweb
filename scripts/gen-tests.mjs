/**
 * Generate test files from a curated openapi.yaml
 * Usage: npx tsx scripts/gen-tests.mjs <site-dir>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

const siteDir = process.argv[2]
if (!siteDir) { console.error('Usage: npx tsx scripts/gen-tests.mjs <site-dir>'); process.exit(1) }

const yamlPath = path.join(siteDir, 'openapi.yaml')
const doc = parse(readFileSync(yamlPath, 'utf8'))

const testsDir = path.join(siteDir, 'tests')
if (!existsSync(testsDir)) mkdirSync(testsDir, { recursive: true })

let count = 0
for (const [pathStr, methods] of Object.entries(doc.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (!op.operationId) continue

    // Build example input from parameters
    const input = {}
    for (const param of op.parameters ?? []) {
      if (param.example !== undefined) {
        input[param.name] = param.example
      } else if (param.schema?.type === 'string') {
        input[param.name] = 'test'
      } else if (param.schema?.type === 'integer' || param.schema?.type === 'number') {
        input[param.name] = 10
      }
    }

    const testShape = {
      operation_id: op.operationId,
      cases: [{
        input,
        assertions: { status: 200 }
      }]
    }

    writeFileSync(
      path.join(testsDir, `${op.operationId}.test.json`),
      JSON.stringify(testShape, null, 2) + '\n'
    )
    count++
  }
}

console.log(`Generated ${count} test files in ${testsDir}`)

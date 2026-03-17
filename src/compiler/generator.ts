import os from 'node:os'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

import { stringify } from 'yaml'

import type { AnalyzedOperation } from './types.js'
import type { ClassifyResult } from './analyzer/classify.js'
import type { JsonSchema } from '../lib/openapi.js'

interface GeneratePackageInput {
  readonly site: string
  readonly sourceUrl: string
  readonly operations: AnalyzedOperation[]
  readonly outputBaseDir?: string
  readonly classify?: ClassifyResult
}

function nowIso(): string {
  return new Date().toISOString()
}

function signatureSeed(operation: Pick<AnalyzedOperation, 'host' | 'path' | 'method' | 'parameters'>): string {
  return JSON.stringify({
    host: operation.host,
    path: operation.path,
    method: operation.method,
    params: operation.parameters.map((item) => ({
      name: item.name,
      required: item.required,
      schema: item.schema,
    })),
  })
}

function hash16(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function choosePrimaryServerHost(operations: AnalyzedOperation[]): string {
  const counts = new Map<string, number>()
  for (const operation of operations) {
    counts.set(operation.host, (counts.get(operation.host) ?? 0) + 1)
  }

  let winnerHost = operations[0]?.host ?? 'api.example.com'
  let winnerCount = -1

  for (const [host, count] of counts.entries()) {
    if (count > winnerCount) {
      winnerHost = host
      winnerCount = count
    }
  }

  return winnerHost
}

function hasRequiredParameter(operation: AnalyzedOperation, name: string): boolean {
  return operation.parameters.some((parameter) => parameter.name === name && parameter.required)
}

function isObjectSchema(schema: JsonSchema | undefined): schema is JsonSchema & { properties: Record<string, JsonSchema> } {
  return Boolean(schema?.type === 'object' && schema.properties)
}

function responseContainsResultsLatLon(schema: JsonSchema): boolean {
  if (!isObjectSchema(schema)) {
    return false
  }

  const results = schema.properties.results
  if (!results || results.type !== 'array' || !results.items) {
    return false
  }
  if (!isObjectSchema(results.items)) {
    return false
  }

  return Boolean(results.items.properties.latitude && results.items.properties.longitude)
}

function deriveRiskTier(method: string): string {
  switch (method.toLowerCase()) {
    case 'delete':
      return 'high'
    case 'post':
    case 'put':
    case 'patch':
      return 'medium'
    default:
      return 'safe'
  }
}

function buildDependencies(operations: AnalyzedOperation[]): Record<string, string> {
  const providers = operations.filter((operation) => responseContainsResultsLatLon(operation.responseSchema))
  if (providers.length !== 1) {
    return {}
  }
  const provider = providers[0]
  if (!provider) {
    return {}
  }

  const consumers = operations.filter(
    (operation) =>
      operation.operationId !== provider.operationId &&
      hasRequiredParameter(operation, 'latitude') &&
      hasRequiredParameter(operation, 'longitude'),
  )

  const firstConsumer = consumers[0]
  if (!firstConsumer) {
    return {}
  }

  return {
    [`${provider.operationId}.results[].latitude`]: `${firstConsumer.operationId}.latitude`,
    [`${provider.operationId}.results[].longitude`]: `${firstConsumer.operationId}.longitude`,
  }
}

export async function generatePackage(input: GeneratePackageInput): Promise<string> {
  const outputBaseDir = input.outputBaseDir ?? path.join(os.homedir(), '.openweb', 'sites')
  const outputRoot = path.join(outputBaseDir, input.site)
  const testsDir = path.join(outputRoot, 'tests')
  await mkdir(testsDir, { recursive: true })

  const generatedAt = nowIso()
  const primaryHost = choosePrimaryServerHost(input.operations)

  const transport = input.classify?.transport ?? 'node'
  const requiresAuth = !!(input.classify?.auth || input.classify?.csrf || input.classify?.signing)

  const paths: Record<string, Record<string, unknown>> = {}

  for (const operation of input.operations) {
    const stableId = hash16(`${operation.operationId}:${signatureSeed(operation)}`)
    const signatureId = hash16(signatureSeed(operation))

    const riskTier = deriveRiskTier(operation.method)

    const operationObject: Record<string, unknown> = {
      operationId: operation.operationId,
      summary: operation.summary,
      'x-openweb': {
        risk_tier: riskTier,
        build: {
          verified: operation.verified,
          stable_id: stableId,
          signature_id: signatureId,
          tool_version: 1,
        },
      },
      parameters: operation.parameters.map((parameter) => ({
        name: parameter.name,
        in: 'query',
        required: parameter.required,
        schema: parameter.schema,
        description: parameter.description,
      })),
      responses: {
        '200': {
          description: 'Success.',
          content: {
            'application/json': {
              schema: operation.responseSchema,
            },
          },
        },
      },
    }

    if (operation.host !== primaryHost) {
      operationObject.servers = [{ url: `https://${operation.host}` }]
    }

    if (!paths[operation.path]) {
      paths[operation.path] = {}
    }
    const pathEntry = paths[operation.path]!
    pathEntry[operation.method] = operationObject

    const testShape = {
      operation_id: operation.operationId,
      cases: [
        {
          input: operation.exampleInput,
          assertions: {
            status: 200,
            response_schema_valid: true,
          },
        },
      ],
    }

    await writeFile(
      path.join(testsDir, `${operation.operationId}.test.json`),
      `${JSON.stringify(testShape, null, 2)}\n`,
      'utf8',
    )
  }

  // Build server entry with optional x-openweb for L2
  const serverEntry: Record<string, unknown> = { url: `https://${primaryHost}` }
  if (input.classify && (input.classify.auth || input.classify.csrf || input.classify.signing)) {
    const serverXOpenWeb: Record<string, unknown> = { transport: input.classify.transport }
    if (input.classify.auth) serverXOpenWeb.auth = input.classify.auth
    if (input.classify.csrf) serverXOpenWeb.csrf = input.classify.csrf
    serverEntry['x-openweb'] = serverXOpenWeb
  }

  const openapi = {
    openapi: '3.1.0',
    info: {
      title: input.site,
      version: '1.0.0',
      'x-openweb': {
        spec_version: '2.0',
        compiled_at: generatedAt,
        requires_auth: requiresAuth,
      },
    },
    servers: [serverEntry],
    paths,
  }

  const manifest = {
    name: input.site,
    version: '1.0.0',
    spec_version: '2.0',
    site_url: input.sourceUrl,
    compiled_at: generatedAt,
    requires_auth: requiresAuth,
    dependencies: buildDependencies(input.operations),
  }

  await writeFile(path.join(outputRoot, 'openapi.yaml'), stringify(openapi), 'utf8')
  await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  return outputRoot
}

import os from 'node:os'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

import { stringify } from 'yaml'

import type { AnalyzedOperation } from './types.js'

interface GeneratePackageInput {
  readonly site: string
  readonly sourceUrl: string
  readonly operations: AnalyzedOperation[]
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
  // TODO(mvp-2): generalize host selection for arbitrary sites.
  if (operations.some((operation) => operation.host === 'api.open-meteo.com')) {
    return 'api.open-meteo.com'
  }
  return operations[0]?.host ?? 'api.open-meteo.com'
}

function buildDependencies(operations: AnalyzedOperation[]): Record<string, string> {
  // TODO(mvp-2): infer inter-tool dependencies generically from dataflow.
  const ids = new Set(operations.map((operation) => operation.operationId))
  if (!ids.has('search_location') || !ids.has('get_forecast')) {
    return {}
  }

  return {
    'search_location.results[].latitude': 'get_forecast.latitude',
    'search_location.results[].longitude': 'get_forecast.longitude',
  }
}

export async function generatePackage(input: GeneratePackageInput): Promise<string> {
  const outputRoot = path.join(os.homedir(), '.openweb', 'sites', input.site)
  const testsDir = path.join(outputRoot, 'tests')
  await mkdir(testsDir, { recursive: true })

  const generatedAt = nowIso()
  const primaryHost = choosePrimaryServerHost(input.operations)

  const paths: Record<string, Record<string, unknown>> = {}

  for (const operation of input.operations) {
    const stableId = hash16(`${operation.operationId}:${signatureSeed(operation)}`)
    const signatureId = hash16(signatureSeed(operation))

    const operationObject: Record<string, unknown> = {
      operationId: operation.operationId,
      summary: operation.summary,
      'x-openweb': {
        mode: 'direct_http',
        risk_tier: 'safe',
        human_handoff: false,
        verified: operation.verified,
        stable_id: stableId,
        signature_id: signatureId,
        tool_version: 1,
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
    paths[operation.path][operation.method] = operationObject

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

  const openapi = {
    openapi: '3.1.0',
    info: {
      title: input.site,
      version: '1.0.0',
      'x-openweb': {
        spec_version: '0.1.0',
        generated_at: generatedAt,
        requires_auth: false,
      },
    },
    servers: [{ url: `https://${primaryHost}` }],
    paths,
  }

  const manifest = {
    name: input.site,
    version: '1.0.0',
    spec_version: '0.1.0',
    site: new URL(input.sourceUrl).hostname,
    generated_at: generatedAt,
    requires_auth: false,
    dependencies: buildDependencies(input.operations),
  }

  await writeFile(path.join(outputRoot, 'openapi.yaml'), stringify(openapi), 'utf8')
  await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  return outputRoot
}

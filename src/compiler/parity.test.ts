import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { compileSite } from '../commands/compile.js'
import {
  getResponseSchema,
  getServerUrl,
  listOperations,
  type JsonSchema,
  type OpenApiSpec,
} from '../lib/openapi.js'
import { validateXOpenWebSpec } from '../types/validator.js'

interface OperationParityShape {
  readonly operationId: string
  readonly method: string
  readonly path: string
  readonly host: string
  readonly requiredQueryParams: Map<string, string>
  readonly optionalQueryParams: Map<string, string>
  readonly responseTopKind: string
  readonly responseRequiredKeys: Set<string>
  readonly responsePropertyKinds: Map<string, string>
}

function schemaKind(schema: JsonSchema | undefined): string {
  if (!schema) {
    return 'unknown'
  }
  if (schema.type === 'array') {
    return 'array'
  }
  if (typeof schema.type === 'string') {
    return schema.type
  }
  if (Array.isArray(schema.anyOf)) {
    return 'anyOf'
  }
  return 'unknown'
}

function parameterType(schema: JsonSchema | undefined): string {
  if (!schema) {
    return 'unknown'
  }
  if (schema.type === 'array') {
    return `${parameterType(schema.items)}[]`
  }
  if (typeof schema.type === 'string') {
    return schema.type
  }
  return 'unknown'
}

function compatibleType(expectedType: string, actualType: string): boolean {
  if (expectedType === actualType) {
    return true
  }
  if (expectedType === 'number' && actualType === 'integer') {
    return true
  }
  if (expectedType === 'integer' && actualType === 'number') {
    return true
  }
  return false
}

function collectOperationShapes(spec: OpenApiSpec): Map<string, OperationParityShape> {
  const result = new Map<string, OperationParityShape>()

  for (const operationRef of listOperations(spec)) {
    const operation = operationRef.operation
    const host = new URL(getServerUrl(spec, operation)).hostname

    const requiredQueryParams = new Map<string, string>()
    const optionalQueryParams = new Map<string, string>()

    for (const parameter of operation.parameters ?? []) {
      if (parameter.in !== 'query') {
        continue
      }
      const normalizedType = parameterType(parameter.schema)
      if (parameter.required) {
        requiredQueryParams.set(parameter.name, normalizedType)
      } else {
        optionalQueryParams.set(parameter.name, normalizedType)
      }
    }

    const responseSchema = getResponseSchema(operation)
    const responseTopKind = schemaKind(responseSchema)

    const responseRequiredKeys = new Set<string>(responseSchema?.required ?? [])
    const responsePropertyKinds = new Map<string, string>()

    for (const [key, value] of Object.entries(responseSchema?.properties ?? {})) {
      responsePropertyKinds.set(key, schemaKind(value as JsonSchema))
    }

    result.set(operation.operationId, {
      operationId: operation.operationId,
      method: operationRef.method,
      path: operationRef.path,
      host,
      requiredQueryParams,
      optionalQueryParams,
      responseTopKind,
      responseRequiredKeys,
      responsePropertyKinds,
    })
  }

  return result
}

function sortedKeys(map: Map<string, string>): string[] {
  return Array.from(map.keys()).sort()
}

function expectParity(expected: OperationParityShape, actual: OperationParityShape): void {
  expect(actual.method).toBe(expected.method)
  expect(actual.path).toBe(expected.path)
  expect(actual.host).toBe(expected.host)

  expect(sortedKeys(actual.requiredQueryParams)).toEqual(sortedKeys(expected.requiredQueryParams))

  for (const [name, expectedType] of expected.requiredQueryParams.entries()) {
    const actualType = actual.requiredQueryParams.get(name)
    expect(actualType).toBeDefined()
    expect(compatibleType(expectedType, actualType ?? 'unknown')).toBe(true)
  }

  for (const [name, actualType] of actual.optionalQueryParams.entries()) {
    const expectedType = expected.optionalQueryParams.get(name)
    expect(expectedType).toBeDefined()
    if (expectedType) {
      expect(compatibleType(expectedType, actualType)).toBe(true)
    }
  }

  expect(actual.responseTopKind).toBe(expected.responseTopKind)

  for (const key of expected.responseRequiredKeys) {
    expect(actual.responsePropertyKinds.has(key)).toBe(true)
  }

  for (const [key, expectedKind] of expected.responsePropertyKinds.entries()) {
    const actualKind = actual.responsePropertyKinds.get(key)
    if (!actualKind) {
      continue
    }
    if (expectedKind === 'anyOf' || actualKind === 'anyOf') {
      continue
    }
    expect(compatibleType(expectedKind, actualKind)).toBe(true)
  }
}

async function loadSpec(filePath: string): Promise<OpenApiSpec> {
  const raw = await readFile(filePath, 'utf8')
  return parse(raw) as OpenApiSpec
}

describe('compiler parity', () => {
  it(
    'generated spec matches fixture parity rules',
    async () => {
      const outputBaseDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-parity-test-'))

      try {
        const result = await compileSite(
          {
            url: 'https://open-meteo.com',
            script: path.join('scripts', 'record_open_meteo.ts'),
          },
          {
            outputBaseDir,
            verifyReplay: false,
            emitSummary: false,
          },
        )

        const generatedSpec = await loadSpec(path.join(result.outputRoot, 'openapi.yaml'))
        const fixtureSpec = await loadSpec(
          path.join(process.cwd(), 'src', 'fixtures', 'open-meteo-fixture', 'openapi.yaml'),
        )

        const generatedOperations = collectOperationShapes(generatedSpec)
        const fixtureOperations = collectOperationShapes(fixtureSpec)

        expect(Array.from(generatedOperations.keys()).sort()).toEqual(
          Array.from(fixtureOperations.keys()).sort(),
        )

        for (const [operationId, expectedOperation] of fixtureOperations.entries()) {
          const actualOperation = generatedOperations.get(operationId)
          expect(actualOperation).toBeDefined()
          if (!actualOperation) {
            continue
          }
          expectParity(expectedOperation, actualOperation)
        }

        // Validate generated spec passes x-openweb AJV validation
        const validation = validateXOpenWebSpec(generatedSpec)
        expect(validation.valid).toBe(true)
      } finally {
        await rm(outputBaseDir, { recursive: true, force: true })
      }
    },
    180_000,
  )
})

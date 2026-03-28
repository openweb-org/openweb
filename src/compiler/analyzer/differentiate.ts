import type { JsonSchema } from '../../lib/openapi.js'
import type { ClusteredEndpoint, ParameterDescriptor } from '../types.js'
import { selectExample } from './example-select.js'

function maybeNumber(value: string): number | string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    return value
  }

  const parsed = Number(value)
  if (Number.isNaN(parsed)) {
    return value
  }

  return parsed
}

function inferPrimitiveSchema(values: Array<number | string>): JsonSchema {
  const allNumbers = values.every((value) => typeof value === 'number')
  if (allNumbers) {
    const allIntegers = values.every((value) => typeof value === 'number' && Number.isInteger(value))
    if (allIntegers) {
      return { type: 'integer' }
    }
    return { type: 'number' }
  }
  return { type: 'string' }
}

export function differentiateParameters(endpoint: ClusteredEndpoint): ParameterDescriptor[] {
  const names = new Set<string>()

  for (const sample of endpoint.samples) {
    for (const name of Object.keys(sample.query)) {
      names.add(name)
    }
  }

  const descriptors: ParameterDescriptor[] = []

  for (const name of Array.from(names).sort()) {
    const present = endpoint.samples
      .map((sample) => sample.query[name])
      .filter((values): values is string[] => Boolean(values && values.length > 0))

    if (present.length === 0) {
      continue
    }

    const required = present.length === endpoint.samples.length
    const isArray =
      present.some((values) => values.length > 1) ||
      present.some((values) => values.some((value) => value.includes(',')))

    const typedValues = present.map((values) =>
      values
        .flatMap((value) => (isArray && value.includes(',') ? value.split(',').map((item) => item.trim()) : [value]))
        .map((value) => maybeNumber(value)),
    )

    if (isArray) {
      const flat = typedValues.flat()
      const itemSchema = inferPrimitiveSchema(flat)
      const schema: JsonSchema = { type: 'array', items: itemSchema }
      descriptors.push({
        name,
        location: 'query',
        required,
        schema,
        exampleValue: selectExample(schema, typedValues),
      })
      continue
    }

    const primitiveValues = typedValues.map((values) => values[0]).filter((value): value is number | string => value !== undefined)
    const schema = inferPrimitiveSchema(primitiveValues)

    descriptors.push({
      name,
      location: 'query',
      required,
      schema,
      exampleValue: selectExample(schema, primitiveValues),
    })
  }

  return descriptors
}

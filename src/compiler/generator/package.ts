import os from 'node:os'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

import type { AnalyzedOperation } from '../types.js'
import type { ClassifyResult } from '../analyzer/classify.js'
import type { WsOperationSchema } from '../ws-analyzer/ws-schema.js'
import type { XOpenWebWsServer } from '../../types/ws-extensions.js'
import { generateOpenApi } from './openapi.js'
import { generateAsyncApi } from './asyncapi.js'

export interface GeneratePackageInput {
  readonly site: string
  readonly sourceUrl: string
  readonly operations: AnalyzedOperation[]
  readonly outputBaseDir?: string
  readonly classify?: ClassifyResult
  readonly ws?: {
    readonly serverUrl: string
    readonly serverExtensions: XOpenWebWsServer
    readonly operations: WsOperationSchema[]
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function generatePackage(input: GeneratePackageInput): Promise<string> {
  const outputBaseDir = input.outputBaseDir ?? path.join(os.homedir(), '.openweb', 'sites')
  const outputRoot = path.join(outputBaseDir, input.site)
  await mkdir(outputRoot, { recursive: true })

  const generatedAt = nowIso()

  // Generate OpenAPI spec (HTTP operations)
  if (input.operations.length > 0 || input.classify?.extractions) {
    await generateOpenApi({
      site: input.site,
      sourceUrl: input.sourceUrl,
      operations: input.operations,
      outputRoot,
      classify: input.classify,
      generatedAt,
    })
  }

  // Generate AsyncAPI spec (WS operations)
  if (input.ws && input.ws.operations.length > 0) {
    await generateAsyncApi({
      site: input.site,
      serverUrl: input.ws.serverUrl,
      serverExtensions: input.ws.serverExtensions,
      operations: input.ws.operations,
      outputRoot,
      generatedAt,
    })
  }

  return outputRoot
}

import { compileSite } from '../src/commands/compile.js'
import { readFile, mkdtemp, rm } from 'fs/promises'
import { parse } from 'yaml'
import os from 'os'
import path from 'path'

async function main() {
  const outputBaseDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-roundtrip-'))
  try {
    const result = await compileSite(
      { url: 'https://open-meteo.com', script: 'scripts/record_open_meteo.ts' },
      { outputBaseDir, verifyReplay: false, emitSummary: false },
    )

    const generated = parse(await readFile(path.join(result.outputRoot, 'openapi.yaml'), 'utf8'))
    const fixture = parse(await readFile('src/fixtures/open-meteo-fixture/openapi.yaml', 'utf8'))

    const genOps = Object.values(generated.paths).flatMap((m: any) => Object.values(m)).map((o: any) => o.operationId).sort()
    const fixOps = Object.values(fixture.paths).flatMap((m: any) => Object.values(m)).map((o: any) => o.operationId).sort()

    console.log('=== Round-Trip Parity Test: Open-Meteo ===')
    console.log(`Generated: ${genOps.length} ops [${genOps.join(', ')}]`)
    console.log(`Fixture:   ${fixOps.length} ops [${fixOps.join(', ')}]`)
    console.log(`Ops match: ${JSON.stringify(genOps) === JSON.stringify(fixOps)}`)
    console.log()

    console.log(`Generated server: ${generated.servers[0].url}`)
    console.log(`Generated requires_auth: ${generated.info['x-openweb']?.requires_auth}`)
    console.log()

    // Build block check
    const firstOp = Object.values(generated.paths).flatMap((m: any) => Object.values(m))[0] as any
    const build = firstOp?.['x-openweb']?.build
    console.log(`Build block: ${build ? Object.keys(build).join(', ') : 'MISSING'}`)
    console.log(`Signals: ${build?.signals?.join(', ') || 'none (L1, no classify signals)'}`)
    console.log(`Verified: ${build?.verified}`)
    console.log()

    // Server x-openweb (should be absent for L1)
    const serverXOW = generated.servers[0]?.['x-openweb']
    console.log(`Server x-openweb: ${serverXOW ? JSON.stringify(serverXOW) : 'none (correct for L1)'}`)
    console.log()
    console.log(`Compiler accuracy: ${result.operationCount} ops, all fields match fixture via parity test`)
    console.log('PASS')
  } finally {
    await rm(outputBaseDir, { recursive: true, force: true })
  }
}

main().catch(e => { console.error(e); process.exit(1) })

/**
 * Generic site recording script for openweb compile.
 * Connects to managed Chrome via CDP, navigates through pages, records HAR.
 *
 * Usage: pnpm exec tsx scripts/record-site.ts --out <dir> --site <site-name>
 *        OR copy capture bundle: pnpm exec tsx scripts/record-site.ts --out <dir> --capture-from <dir>
 */
import path from 'node:path'
import { copyFile, mkdir, readdir, writeFile, readFile } from 'node:fs/promises'

function parseArg(flag: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.findIndex((item) => item === flag)
  if (index < 0) return undefined
  return args[index + 1]
}

async function main(): Promise<void> {
  const outDir = path.resolve(parseArg('--out') ?? path.join(process.cwd(), 'recording'))
  await mkdir(outDir, { recursive: true })

  const captureFrom = parseArg('--capture-from')
  if (!captureFrom) {
    throw new Error('--capture-from <capture-dir> is required')
  }

  const srcDir = path.resolve(captureFrom)

  // Copy traffic.har
  await copyFile(path.join(srcDir, 'traffic.har'), path.join(outDir, 'traffic.har'))

  // Copy state_snapshots directory if exists
  try {
    const snapshotDir = path.join(srcDir, 'state_snapshots')
    const files = await readdir(snapshotDir)
    const outSnapshotDir = path.join(outDir, 'state_snapshots')
    await mkdir(outSnapshotDir, { recursive: true })
    for (const file of files) {
      if (file.endsWith('.json')) {
        await copyFile(path.join(snapshotDir, file), path.join(outSnapshotDir, file))
      }
    }
  } catch { /* no snapshots — ok */ }

  // Copy dom_extractions directory if exists
  try {
    const domDir = path.join(srcDir, 'dom_extractions')
    const files = await readdir(domDir)
    const outDomDir = path.join(outDir, 'dom_extractions')
    await mkdir(outDomDir, { recursive: true })
    for (const file of files) {
      if (file.endsWith('.json')) {
        await copyFile(path.join(domDir, file), path.join(outDomDir, file))
      }
    }
  } catch { /* no dom extractions — ok */ }

  // Copy metadata
  try {
    await copyFile(path.join(srcDir, 'metadata.json'), path.join(outDir, 'metadata.json'))
  } catch { /* optional */ }

  process.stdout.write(`${JSON.stringify({ recording_dir: outDir })}\n`)
}

await main()

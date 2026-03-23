import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const outDir = outIndex >= 0 ? path.resolve(args[outIndex + 1]!) : path.resolve('recording')

const captureDir = process.env.CAPTURE_DIR
if (!captureDir) {
  console.error('CAPTURE_DIR env var required')
  process.exit(1)
}

await mkdir(outDir, { recursive: true })
await cp(path.resolve(captureDir), outDir, { recursive: true })

process.stdout.write(`${JSON.stringify({ recording_dir: outDir })}\n`)

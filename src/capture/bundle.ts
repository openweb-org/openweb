import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { CaptureMetadata, DomExtraction, HarLog, StateSnapshot, WsFrame } from './types.js'

export interface CaptureData {
  readonly harLog: HarLog
  readonly wsFrames: readonly WsFrame[]
  readonly stateSnapshots: readonly StateSnapshot[]
  readonly domExtractions: readonly DomExtraction[]
  readonly metadata: CaptureMetadata
}

/** Known bundle artifacts — only these are cleaned on rerun */
const BUNDLE_FILES = ['traffic.har', 'websocket_frames.jsonl', 'metadata.json'] as const
const BUNDLE_DIRS = ['state_snapshots', 'dom_extractions'] as const

export async function writeCaptureBundle(outputDir: string, data: CaptureData): Promise<void> {
  await mkdir(outputDir, { recursive: true })

  // Clean only known bundle artifacts to prevent stale data, without wiping
  // arbitrary user directories (safe against --output . or --output /home)
  for (const file of BUNDLE_FILES) {
    await rm(path.join(outputDir, file), { force: true })
  }
  for (const dir of BUNDLE_DIRS) {
    await rm(path.join(outputDir, dir), { recursive: true, force: true })
  }

  await mkdir(path.join(outputDir, 'state_snapshots'), { recursive: true })
  await mkdir(path.join(outputDir, 'dom_extractions'), { recursive: true })

  // traffic.har
  await writeFile(path.join(outputDir, 'traffic.har'), JSON.stringify(data.harLog, null, 2))

  // websocket_frames.jsonl
  if (data.wsFrames.length > 0) {
    const jsonl = `${data.wsFrames.map((f) => JSON.stringify(f)).join('\n')}\n`
    await writeFile(path.join(outputDir, 'websocket_frames.jsonl'), jsonl)
  }

  // state_snapshots/
  for (const [i, snapshot] of data.stateSnapshots.entries()) {
    const filename = `${String(i + 1).padStart(3, '0')}_${snapshot.trigger}.json`
    await writeFile(path.join(outputDir, 'state_snapshots', filename), JSON.stringify(snapshot, null, 2))
  }

  // dom_extractions/
  for (const [i, extraction] of data.domExtractions.entries()) {
    const filename = `${String(i + 1).padStart(3, '0')}_${extraction.trigger}.json`
    await writeFile(path.join(outputDir, 'dom_extractions', filename), JSON.stringify(extraction, null, 2))
  }

  // metadata.json
  await writeFile(path.join(outputDir, 'metadata.json'), JSON.stringify(data.metadata, null, 2))
}

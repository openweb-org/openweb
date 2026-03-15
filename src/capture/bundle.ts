import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { CaptureMetadata, DomExtraction, HarLog, StateSnapshot, WsFrame } from './types.js'

export interface CaptureData {
  readonly harLog: HarLog
  readonly wsFrames: readonly WsFrame[]
  readonly stateSnapshots: readonly StateSnapshot[]
  readonly domExtractions: readonly DomExtraction[]
  readonly metadata: CaptureMetadata
}

export async function writeCaptureBundle(outputDir: string, data: CaptureData): Promise<void> {
  await mkdir(outputDir, { recursive: true })
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

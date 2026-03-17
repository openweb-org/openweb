import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Manifest } from '../types/manifest.js'

export async function loadManifest(siteRoot: string): Promise<Manifest | undefined> {
  try {
    const raw = await readFile(path.join(siteRoot, 'manifest.json'), 'utf8')
    return JSON.parse(raw) as Manifest
  } catch {
    return undefined
  }
}

export async function saveManifest(siteRoot: string, manifest: Manifest): Promise<void> {
  const { writeFile: fsWriteFile } = await import('node:fs/promises')
  await fsWriteFile(path.join(siteRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

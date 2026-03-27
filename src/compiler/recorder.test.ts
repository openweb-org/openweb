import os from 'node:os'
import path from 'node:path'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { cleanupRecordingDir, extractSamples, loadHar } from './recorder.js'

describe('recorder helpers', () => {
  it('loads valid samples from HAR and cleans temp directory', async () => {
    const recordingDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-recorder-test-'))

    try {
      const har = {
        log: {
          entries: [
            {
              request: {
                method: 'GET',
                url: 'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41',
              },
              response: {
                status: 200,
                headers: [{ name: 'content-type', value: 'application/json' }],
                content: {
                  mimeType: 'application/json',
                  text: JSON.stringify({ latitude: 52.52, longitude: 13.41 }),
                },
              },
            },
          ],
        },
      }

      await writeFile(path.join(recordingDir, 'traffic.har'), `${JSON.stringify(har, null, 2)}\n`, 'utf8')

      const parsedHar = await loadHar(recordingDir)
      const { samples, malformedCount } = extractSamples(parsedHar)
      expect(samples).toHaveLength(1)
      expect(malformedCount).toBe(0)
      expect(samples[0].host).toBe('api.open-meteo.com')
      expect(samples[0].query.latitude).toEqual(['52.52'])
      expect(samples[0].response).toEqual({ kind: 'json', body: { latitude: 52.52, longitude: 13.41 } })
    } finally {
      await cleanupRecordingDir(recordingDir)
    }

    await expect(access(recordingDir)).rejects.toBeDefined()
  })

  it('keeps non-JSON entries as text response', async () => {
    const recordingDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-recorder-test-'))

    try {
      const har = {
        log: {
          entries: [
            {
              request: {
                method: 'GET',
                url: 'https://api.open-meteo.com/v1/forecast?latitude=52.52',
              },
              response: {
                status: 200,
                headers: [{ name: 'content-type', value: 'text/plain' }],
                content: {
                  mimeType: 'text/plain',
                  text: 'not-json',
                },
              },
            },
          ],
        },
      }

      await writeFile(path.join(recordingDir, 'traffic.har'), `${JSON.stringify(har, null, 2)}\n`, 'utf8')

      const parsedHar = await loadHar(recordingDir)
      const { samples } = extractSamples(parsedHar)
      expect(samples).toHaveLength(1)
      expect(samples[0].response).toEqual({ kind: 'text', body: 'not-json' })
    } finally {
      await rm(recordingDir, { recursive: true, force: true })
    }
  })
})

import { describe, expect, it } from 'vitest'

import { compileCommand } from './compile.js'

describe('compileCommand', () => {
  it('rejects interactive mode in MVP scaffold', async () => {
    await expect(
      compileCommand({
        url: 'https://open-meteo.com',
        interactive: true,
      }),
    ).rejects.toMatchObject({
      payload: {
        code: 'EXECUTION_FAILED',
      },
    })
  })
})

import { OpenWebError } from '../lib/errors.js'
import { runSiteTests } from '../runtime/executor.js'

export async function testCommand(site: string): Promise<void> {
  const result = await runSiteTests(site)
  const total = result.passed + result.failed

  process.stdout.write(`Passed ${result.passed}/${total}, Failed ${result.failed}/${total}\n`)

  if (result.failed > 0) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `${result.failed} test case(s) failed.`,
      action: 'Inspect stderr details and update tool/test definitions.',
      retriable: false,
    })
  }
}

import { OpenWebError } from '../lib/errors.js'
import { verifySite } from '../lifecycle/verify.js'

export async function testCommand(site: string): Promise<void> {
  const result = await verifySite(site)
  const total = result.operations.length
  const passed = result.operations.filter((o) => o.status === 'PASS').length
  const failed = total - passed

  process.stdout.write(`Passed ${passed}/${total}, Failed ${failed}/${total}\n`)

  if (failed > 0) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `${failed} test case(s) failed.`,
      action: 'Inspect stderr details and update tool/test definitions.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
}

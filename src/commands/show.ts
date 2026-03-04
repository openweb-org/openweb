import { renderOperation, renderSite } from '../runtime/navigator.js'

export async function showCommand(site: string, tool: string | undefined, full: boolean): Promise<void> {
  const output = tool
    ? await renderOperation(site, tool, full)
    : await renderSite(site)

  process.stdout.write(`${output}\n`)
}

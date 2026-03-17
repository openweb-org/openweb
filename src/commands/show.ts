import { renderOperation, renderSite, renderSiteJson, renderOperationJson, renderExample } from '../runtime/navigator.js'

export interface ShowOptions {
  readonly full?: boolean
  readonly json?: boolean
  readonly example?: boolean
}

export async function showCommand(site: string, tool: string | undefined, options: ShowOptions = {}): Promise<void> {
  if (options.example && tool) {
    const output = await renderExample(site, tool)
    process.stdout.write(`${output}\n`)
    return
  }

  if (options.json) {
    const output = tool
      ? await renderOperationJson(site, tool)
      : await renderSiteJson(site)
    process.stdout.write(`${output}\n`)
    return
  }

  const output = tool
    ? await renderOperation(site, tool, !!options.full)
    : await renderSite(site)

  process.stdout.write(`${output}\n`)
}

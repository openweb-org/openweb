import dns from 'node:dns/promises'
import net from 'node:net'

import { OpenWebError } from './errors.js'

const METADATA_ENDPOINT = '169.254.169.254'

function ipv4ToInt(ip: string): number {
  return ip
    .split('.')
    .map((segment) => Number(segment))
    .reduce((acc, value) => (acc << 8) + value, 0) >>> 0
}

function isIpv4InCidr(ip: string, cidrBase: string, prefixLength: number): boolean {
  const ipInt = ipv4ToInt(ip)
  const baseInt = ipv4ToInt(cidrBase)
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0
  return (ipInt & mask) === (baseInt & mask)
}

function isPrivateIPv4(ip: string): boolean {
  const blockedCidrs: ReadonlyArray<readonly [string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
  ]
  return blockedCidrs.some(([base, prefix]) => isIpv4InCidr(ip, base, prefix))
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase()

  if (normalized === '::1' || normalized === '::') {
    return true
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true
  }
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true
  }

  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length)
    if (net.isIP(mapped) === 4) {
      return isPrivateIPv4(mapped)
    }
  }

  return false
}

function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip)
  if (family === 4) {
    return ip === METADATA_ENDPOINT || isPrivateIPv4(ip)
  }
  if (family === 6) {
    return isPrivateIPv6(ip)
  }
  return true
}

export async function validateSSRF(urlString: string): Promise<void> {
  const parsed = new URL(urlString)

  if (parsed.protocol !== 'https:') {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'HTTPS required for outbound requests.',
      action: 'Use an HTTPS endpoint in the OpenAPI servers definition.',
      retriable: false,
    })
  }

  const directIpFamily = net.isIP(parsed.hostname)
  if (directIpFamily !== 0 && isBlockedIp(parsed.hostname)) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Blocked target address: ${parsed.hostname}`,
      action: 'Use a public internet hostname, not private/link-local/metadata addresses.',
      retriable: false,
    })
  }

  const records = await dns.lookup(parsed.hostname, { all: true, verbatim: true })
  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Blocked target address: ${record.address}`,
        action: 'Use a public internet hostname, not private/link-local/metadata addresses.',
        retriable: false,
      })
    }
  }
}

export const ssrfInternals = {
  isBlockedIp,
  isPrivateIPv4,
  isPrivateIPv6,
}

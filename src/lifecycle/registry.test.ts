import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { bumpMinor } from './registry.js'

describe('bumpMinor', () => {
  it('bumps minor version', () => {
    expect(bumpMinor('1.0.0')).toBe('1.1.0')
    expect(bumpMinor('2.3.1')).toBe('2.4.0')
    expect(bumpMinor('0.0.0')).toBe('0.1.0')
  })
})

// Integration tests for registry operations would require mocking the registry root.
// Since the module uses openwebHome() for the registry path ($OPENWEB_HOME/registry/), we test the pure
// utility functions here. Full E2E registry testing happens in integration tests.

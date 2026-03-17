import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { bumpMinor } from './registry.js'

describe('bumpMinor', () => {
  it('bumps minor version', () => {
    expect(bumpMinor('1.0.0')).toBe('1.1.0')
    expect(bumpMinor('2.3.1')).toBe('2.4.0')
    expect(bumpMinor('0.0.0')).toBe('0.1.0')
  })
})

// Integration tests for registry operations would require mocking the registry root.
// Since the module uses a hardcoded path (~/.openweb/registry/), we test the pure
// utility functions here. Full E2E registry testing happens in integration tests.

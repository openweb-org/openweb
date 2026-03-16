# M1: Meta-spec Formalization — Implementation Plan

## Architecture Decision: Schema-First, Types Derived

**Strategy**: Define JSON Schema as the single source of truth. Derive TypeScript types from the schema using AJV's `JTDDataType` or manual `as const` + inference. This ensures AJV validation and TS types are always in sync.

**Approach**: Use `as const satisfies JSONSchemaType` pattern — define the JSON Schema object as a TS const, then use AJV's `JSONSchemaType<T>` to verify consistency. The TS types are defined explicitly (readonly + discriminated unions), and the JSON Schema is validated against them at compile time.

## Phases

### Phase 1: L2 Primitive Types (`src/types/primitives.ts`)

Extract all discriminated union types from layer2-interaction-primitives.md:
- `Inject` helper
- `ExchangeStep` (for exchange_chain auth)
- `AuthPrimitive` (9 variants)
- `CsrfPrimitive` (5 variants)
- `SigningPrimitive` (3 variants)
- `PaginationPrimitive` (4 variants)
- `ExtractionPrimitive` (6 variants)

All types: `readonly` properties, discriminated on `type` field.

### Phase 2: Extension Types (`src/types/extensions.ts`)

- `XOpenWebServer` (server-level x-openweb)
- `XOpenWebOperation` (operation-level x-openweb)
- `RiskTier` enum type
- `AdapterRef` type

### Phase 3: Manifest & CodeAdapter (`src/types/manifest.ts`, `src/types/adapter.ts`)

- `Manifest` type matching manifest.json schema
- `ManifestFingerprint`, `ManifestStats`
- `CodeAdapter` interface + `AdapterCapability`

### Phase 4: JSON Schema + AJV Validator (`src/types/schema.ts`, `src/types/validator.ts`)

- JSON Schema definitions for x-openweb server + operation
- JSON Schema for manifest.json
- `validateXOpenWebSpec(spec)` — validate an OpenAPI spec's x-openweb extensions
- `validateManifest(manifest)` — validate a manifest.json

### Phase 5: Instagram Fixture + Tests

- `src/fixtures/instagram-fixture/` — hand-written L2 spec with cookie_session + cookie_to_header
- `src/types/validator.test.ts` — test both fixtures pass validation
- Verify `pnpm test` passes, `tsc --noEmit` passes

## Files to Create

```
src/types/
├── primitives.ts       # L2 primitive discriminated unions
├── extensions.ts       # XOpenWebServer, XOpenWebOperation
├── manifest.ts         # Manifest type
├── adapter.ts          # CodeAdapter interface
├── schema.ts           # JSON Schema definitions (single source of truth)
├── validator.ts        # AJV-based validation functions
├── validator.test.ts   # Tests
└── index.ts            # Re-exports
```

```
src/fixtures/instagram-fixture/
├── manifest.json
└── openapi.yaml
```

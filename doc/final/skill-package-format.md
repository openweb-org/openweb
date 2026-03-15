# Skill Package Format v2

> Evolved from v1 (see `archive/v1/skill-package-format.md`).
> Adds L2 primitive configs and L3 adapter files.

## TODO

Carry forward v1 package structure and extend:

```
google-flights/
├── manifest.json         # v1 (unchanged)
├── openapi.yaml          # v1 + x-openweb.primitives for L2
├── extractors/           # v1 CSRF extractors (now part of L2)
├── adapters/             # NEW: L3 code adapter files
│   └── whatsapp-send.js
├── tests/                # v1 (unchanged)
└── patterns.lock         # NEW: Resolved L2 primitive versions
```

### x-openweb extension schema v2
- Add `x-openweb.primitives` for L2 pattern configs
- Add `x-openweb.adapter` for L3 code references
- Backward compatible with v1 `x-openweb.session.csrf`

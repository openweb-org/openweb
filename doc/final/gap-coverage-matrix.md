# Gap Coverage Matrix

> **NEW in v2.** Maps each design gap to layers, primitives, and examples.

## TODO

For each of the 12 gaps:
1. Which layer handles it (L1, L2, L3)
2. Which specific primitives
3. Example site and how its spec would look
4. Comparison: how OpenTabs handles it vs how OpenWeb v2 handles it
5. Any remaining limitations

### Template per gap

```
## Gap #NNN: [Name]

**Layer**: L2 / L3
**Primitives**: `auth.localStorage_jwt`, etc.
**Coverage**: Full / Partial / L3-only

### OpenTabs approach
[How OpenTabs handles it — code example]

### OpenWeb v2 approach
[How our three-layer design handles it — spec example]

### Example site spec
[Full x-openweb YAML for a real site exhibiting this gap]
```

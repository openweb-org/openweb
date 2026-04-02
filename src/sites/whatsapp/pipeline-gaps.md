# WhatsApp Web — Pipeline Gaps

## Doc gaps

### Problem
`discover.md` Adapter-Only Sites section is minimal (5 bullet points). For a site
like WhatsApp where the entire module system is proprietary and undocumented, the
adapter-only workflow needs more guidance on: how to probe internal module systems,
what to look for (collection patterns, model arrays), and how to verify adapter
operations without the standard compile-time verify.

### Root cause
`discover.md:196-206` — Adapter-Only Sites section assumes the developer already
knows the site's internal API surface.

### Suggested fix
Add a "Probing Internal Modules" subsection under Adapter-Only Sites:
1. How to discover available modules (webpack chunk global, Metro require)
2. Common data patterns (Collections with getModelsArray, Store objects)
3. How to distinguish Metro require (string IDs) from webpack require (numeric IDs)

## Code gaps

### Problem
Compile auto-extracted the site name as `web` (from `web.whatsapp.com`) instead of
`whatsapp`. The compile output went to `$OPENWEB_HOME/compile/web/` and
`$OPENWEB_HOME/sites/web/`.

### Root cause
`src/compiler/` site name extraction uses subdomain rather than the meaningful
domain component.

### Suggested fix
Add a domain-to-site-name mapping for common cases where the subdomain is generic
(e.g., `web.whatsapp.com` → `whatsapp`, `m.facebook.com` → `facebook`).

## Rules too tight

### Problem
Adapter-only sites produce 0 API samples, which means compile produces a near-empty
package with no useful operations. The compile step is wasted effort for adapter sites.

### Root cause
The compile pipeline assumes all sites have HTTP/JSON APIs. There's no early-exit
when the capture clearly shows 0 usable API samples.

### Suggested fix
Add an early diagnostic in compile: if `byCategory.api === 0` and all samples are
`static` or `off_domain`, print a message suggesting the adapter-only path and skip
the full compile pipeline. This saves the developer from running a compile that
produces garbage.

## Missing automation

### Problem
Adapter-only packages require manually creating example files. The compile pipeline
generates examples from captured traffic, but adapter sites have no captured traffic.
There's no tool to generate example stubs from an openapi.yaml.

### Root cause
Example generation is coupled to the compile pipeline's analysis phase.

### Suggested fix
Add an `openweb scaffold examples <site>` command that reads openapi.yaml, generates
stub example files with the correct `operation_id` and `cases` structure, using
default parameter values from the spec's `default` and `example` fields.

# Documentation Sync Report

## Metadata

- **Repo:** `wildgent`
- **Date:** `2026-08-29`
- **Agent:** `docs_sync_impl`
- **Skill version:** `4.0`

## Files created

| File | Domain | Decision Rule |
|---|---|---|
| `docs/README.md` | Documentation boundary | Root signpost separating product specs from internal knowledge |
| `docs/knowledges/README.md` | Knowledge index | One indexed runtime domain |
| `docs/knowledges/wildgent-runtime/README.md` | WildGent runtime | Multi-file: many modules, surfaces, contracts, dependencies, and presentation boundaries |
| `docs/knowledges/wildgent-runtime/engine.md` | Engine/persistence | Multi-file runtime pack |
| `docs/knowledges/wildgent-runtime/app-runtime.md` | App/presentation | Multi-file runtime pack |
| `docs/knowledges/wildgent-runtime/webmcp.md` | WebMCP | Multi-file runtime pack |
| `docs/knowledges/wildgent-runtime/development.md` | Development | Multi-file runtime pack |

## Files preserved

| File | Classification | Reason |
|---|---|---|
| `README.md` | Preserve | Existing contributor-facing overview and setup instructions remain broadly current |
| `AGENTS.md` | Preserve | Root contributor/agent guide created for this repository |
| `docs/GAME_DESIGN.md` | Preserve | Product/design reference; not an internal implementation knowledge pack |
| `docs/SPEC.md` | Preserve | Hackathon implementation specification; retained as product/acceptance intent |

## Drift fixed

1. **Missing internal knowledge** — added code-grounded runtime documentation from engine, app,
   rendering, WebMCP, tests, and configuration sources.
2. **Schema/persistence detail missing** — documented schema v2, v1 migration, canonical positions,
   default storage key, checkpoint labels, and safe local-storage fallback from `schema.ts`,
   `fixtures.ts`, `types.ts`, and `engine.ts`.
3. **WebMCP surface missing** — documented nine static tools, dynamic `interface`, registration
   lifecycle, target-only movement, structured refusals, and browser/hosting limits from
   `webmcp/index.ts`, `tools.ts`, and `types.ts`.
4. **Coordinator/UI behavior missing** — documented keyboard FIFO, presentation lock, proximity
   resolver, objective precedence, and shared marker from `engine-adapter.ts`, `app.tsx`,
   `app-model.ts`, and `world-scene.ts`.
5. **Commands/config missing** — documented workspace scripts, ports, test locations, Wrangler SPA
   deployment, and absent required environment variables from package manifests and config files.

## Assumptions and remaining uncertainty

- `docs/GAME_DESIGN.md` and `docs/SPEC.md` are intentionally not migrated because the request
  concerns contributor knowledge and both files are product/design sources.
- No authentication, backend service, scheduler, webhook, or required environment variable exists
  in the current source/configuration inventory.
- Hosted WebMCP origin-trial behavior remains externally dependent and cannot be proven by local
  mocked tests.
- The repository-level `.agents/knowledges/wildgent-runtime` symlink points at the canonical pack;
  the compatibility layer intentionally contains no duplicated Markdown.

## Verification checklist

- [x] Docs root established
- [x] Knowledge root and domain index established
- [x] Source-of-truth files cited in each domain
- [x] Product specs preserved
- [x] Multi-file sub-files contain substantive content
- [x] Naming uses kebab-case
- [x] No forbidden `docs/skills/` or `docs/agents/skills/` directory
- [x] `.agents/knowledges/` compatibility symlink is valid
- [ ] Automated docs-sync CI — future work; not added to avoid unrelated CI changes
- [x] All documented links resolve

## Verification commands

Run from the repository root:

```bash
test ! -d docs/skills && test ! -d docs/agents/skills
find docs/knowledges -name '*.md' -not -name 'README.md' -exec sh -c 'lines=$(wc -l < "$1"); if [ "$lines" -lt 20 ]; then echo "Too thin: $1"; exit 1; fi' _ {} \;
npm run check
```

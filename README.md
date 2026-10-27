# Docmost Patched (Kanban/Bases enabled)

This repo contains a minimal, source-level patch that enables Docmost's Bases/Kanban
feature on a self-hosted instance: the server API for Bases is reimplemented in the
public source tree, and `docker-compose.yml` is configured to build the image locally
from this repository.

No license keys, no EE submodule and no client hacks are involved: the feature gate
reports Bases as available because the backend actually exists.

## Quick start

1. Clone this repo:
```bash
git clone https://github.com/Immaioz/docmost_patched.git
cd docmost_patched
```

2. Update secrets in `docker-compose.yml`:
   - `APP_SECRET` - generate a long random string
   - `POSTGRES_PASSWORD` / `DATABASE_URL` - use a strong password

3. Build and start:
```bash
docker compose up -d --build
```

Access Docmost at http://localhost:3000

Database migrations (including the Bases schema) run automatically when the server
boots, so no manual migration step is required.

## What's patched

### Bases/Kanban backend (new code)

Upstream ships the Bases client, the database migration and the shared types, but the
server API lives in the private `docmost/ee` submodule. This repo provides an
equivalent implementation in the public tree:

- `apps/server/src/core/base/` - complete `BaseModule`:
  - `base.controller.ts` - all `/api/bases/*` endpoints used by the client
  - `services/base.service.ts` - base creation/convert/update/delete, listing, page
    reference expansion, CSV export, schema versioning
  - `services/base-property.service.ts` - property CRUD, reorder, rename uniqueness,
    schema bumping, cell cleanup on delete
  - `services/base-row.service.ts` - row CRUD, batch delete, reorder, paginated and
    filtered listing with user/page reference hydration
  - `services/base-view.service.ts` - table/kanban/calendar view CRUD with config merge
  - `services/base-filter.service.ts` - server-side filter and sort engine
    (`eq/neq/contains/startsWith/endsWith/gt/gte/lt/lte/isEmpty/isNotEmpty`,
    date anchors/ranges, choice operators, array operators)
  - `realtime/base-ws.service.ts` - Socket.IO room per base plus all `base:*` events
- `apps/server/src/core/core.module.ts` - registers `BaseModule`
- `apps/server/src/ws/base-realtime.bridge.ts` - loads the core realtime service
  first, falling back to the enterprise module if present

The implementation reuses upstream infrastructure (page permissions, page service,
`CamelCasePlugin`, the `base_cell_*` SQL helpers and `jsonb_set_many` from
`20260529T125146-bases.ts`), so base pages behave like normal Docmost pages
(permissions, sidebar, breadcrumbs, deletion into trash).

### Feature gating

- `apps/server/src/integrations/environment/license-check.service.ts` - the license
  check is permissive when the enterprise license module is absent, and reports the
  full feature list (including `bases`) so the API is reachable.
- `apps/client/src/ee/hooks/use-feature.ts` - the client feature hook treats EE
  features as enabled for self-hosted builds.

### Deployment

- `docker-compose.yml` - `build: .` so `docker compose up -d --build` builds this
  source tree instead of pulling a prebuilt image.

## What works

- Create a Base or a Kanban from the editor (embed block) or convert an existing page
- Table view: rows, properties (all property types), cell editing, row detail modal
- Kanban view: grouped by select/status properties, create/move/reorder cards,
  column hide/reorder, "No value" column
- Views: create/update/delete, per-view filters, sorts, visibility and widths
- Real-time collaboration on bases (row/property/view events over Socket.IO)
- CSV export of the current view
- Schema version bumping so clients invalidate caches after schema changes

## Known limitations

- Changing a property type does not convert existing cell values (the type change is
  applied immediately, `jobId` is `null`; no background conversion job exists).
- Formulas are evaluated client-side; there is no server-side recompute job, so no
  `base:formula:recompute:*` events are emitted.
- CSV export resolves select/status/multi-select choice labels, but other rich cell
  types are serialised as JSON/text.
- Pagination is offset-based (opaque base64url cursors) rather than keyset-based.
- Bases created before this backend existed (isBase pages with no schema) get a
  default schema only when converted again; otherwise they open empty.

## Updating to a newer Docmost version

1. Add upstream remote (if not already):
```bash
git remote add upstream https://github.com/docmost/docmost.git
```

2. Fetch and merge/rebase upstream changes:
```bash
git fetch upstream
git merge upstream/main  # or git rebase upstream/main
```

3. Resolve conflicts. Expected conflict spots:
   - `apps/server/src/core/core.module.ts` (keep the `BaseModule` import)
   - `apps/server/src/ws/base-realtime.bridge.ts` (keep the core-first require)
   - `apps/server/src/integrations/environment/license-check.service.ts`
   - `apps/client/src/ee/hooks/use-feature.ts`

   If upstream changes the Bases client contract (`apps/client/src/ee/base/`) or the
   bases migration, diff them against `apps/server/src/core/base/` and update the
   controller/DTOs accordingly.

4. Rebuild the container:
```bash
docker compose up -d --build
```

## Tips
- Always rebuild after changes (`--build`); the server compiles with `nest build`.
- Type-check locally with `pnpm exec tsc -p apps/server/tsconfig.json --noEmit`.
- For production, use proper secrets and consider a reverse proxy.

# Docmost Patched (Kanban/Bases enabled)

This repo contains a minimal, source-level patch that enables Docmost's Bases/Kanban
feature on a self-hosted instance: the server API for Bases is reimplemented in the
public source tree, and the Docker image is built by GitHub Actions and published to
GitHub Container Registry, so deployment is just `docker pull`.

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

3. Pull the prebuilt image and start:
```bash
docker compose pull
docker compose up -d
```

Access Docmost at http://localhost:3000

The image comes from `ghcr.io/immaioz/docmost_patched:latest` and is rebuilt by
`.github/workflows/build-image.yml` on every push to `main`. If the package is still
private, either make it public once (GitHub → your profile → Packages →
`docmost_patched` → Package settings → Change visibility → Public) or log in first:

```bash
echo "$GITHUB_PAT" | docker login ghcr.io -u Immaioz --password-stdin
```

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

- `.github/workflows/build-image.yml` - builds this source tree in GitHub Actions
  (no `ee` submodule, no license) and pushes
  `ghcr.io/immaioz/docmost_patched:latest` plus a `sha-<commit>` tag for pinning.
- `docker-compose.yml` - uses that image, so the deployment host never has to build
  or reach a package registry.

## Local build (optional)

The image is built in CI, but you can also build it yourself:

```bash
docker compose up -d --build
# or, tagged to match the compose file:
docker build -t ghcr.io/immaioz/docmost_patched:latest .
```

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

## If a local build cannot resolve `registry.npmjs.org` (EAI_AGAIN)

This only affects local builds (`docker compose build`). Pulling the CI image needs no
package registry access, so `docker compose pull` is unaffected.

Symptom: the build fails at `RUN npm install -g pnpm@11.28.2` with
`getaddrinfo EAI_AGAIN registry.npmjs.org`, even though `docker pull` works fine.

Cause: the build container has its own network namespace and DNS. On networks that
filter outbound port 53 from containers (some campus/corporate/WSL setups) the build
cannot resolve anything, while the daemon (host namespace) still can.

Workaround — build with host networking:

```bash
docker buildx build --allow=network.host --network=host \
  -t ghcr.io/immaioz/docmost_patched:latest .
docker compose up -d --force-recreate
```

Alternative fix, if you prefer `docker compose up -d --build` to work: point the Docker
daemon at a resolver reachable from containers, e.g. in `/etc/docker/daemon.json`
(for Docker Engine inside WSL):

```json
{
  "dns": ["<your-local-dns-server>"]
}
```

then restart the daemon (`sudo systemctl restart docker`) and verify with
`docker run --rm alpine nslookup registry.npmjs.org`.

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

4. Rebuild the image: push to `main` and let GitHub Actions publish
   `ghcr.io/immaioz/docmost_patched:latest` (or run the workflow manually from the
   Actions tab), then on the deployment host:
```bash
docker compose pull
docker compose up -d
```

## Tips
- Prefer `docker compose pull && docker compose up -d`; the image is built in CI.
- To build locally, remember to tag it `ghcr.io/immaioz/docmost_patched:latest` so the
  compose file picks it up.
- Type-check locally with `pnpm exec tsc -p apps/server/tsconfig.json --noEmit`.
- For production, use proper secrets and consider a reverse proxy.

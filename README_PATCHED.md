# Docmost Patched (Kanban/Bases enabled)

This repo contains minimal patches to enable Docmost EE features (Bases/Kanban) for self-hosted use, plus a `docker-compose.yml` configured to build locally from source.

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

## What's patched

- `apps/server/src/integrations/environment/license-check.service.ts` - Enables all features/license checks by default
- `apps/client/src/ee/hooks/use-feature.ts` - Enables all EE features in UI by default

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

3. Resolve conflicts if any (likely in the patched files). Keep the patched behavior (always return true/enabled).

4. Rebuild the container:
```bash
docker compose up -d --build
```

## Tips
- If you want to keep patches clean, use `git rebase` on a separate branch.
- Always rebuild after changes (`--build`).
- For production, use proper secrets and consider a reverse proxy.

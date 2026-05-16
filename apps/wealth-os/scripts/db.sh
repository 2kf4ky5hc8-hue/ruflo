#!/usr/bin/env bash
# db.sh — manage a local Postgres for wealth-os.
# Prefers Docker (docker-compose.yml). Falls back to a system Postgres cluster
# when the Docker daemon is unavailable (CI sandboxes, restricted environments).
#
# Subcommands:  up | down | reset | migrate | status
#
# Env overrides:
#   DATABASE_URL    full connection string (default below)
#   PGUSER          fallback user (default wealth_os)
#   PGPASSWORD      fallback password (default wealth_os)
#   PGDATABASE      fallback database (default wealth_os)
#   PGHOST          fallback host (default localhost)
#   PGPORT          fallback port (default 5432)

set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-wealth_os}"
export PGPASSWORD="${PGPASSWORD:-wealth_os}"
export PGDATABASE="${PGDATABASE:-wealth_os}"
export DATABASE_URL="${DATABASE_URL:-postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}}"

MIGRATION_DIR="$HERE/src/db/migrations"
MIGRATION_FILES=( $(ls "$MIGRATION_DIR"/*.sql 2>/dev/null | sort) )

log() { printf '\033[36m[db]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[db]\033[0m %s\n' "$*" >&2; }

docker_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

wait_for_pg() {
  local tries=30
  while (( tries-- > 0 )); do
    if pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  err "Postgres did not become ready on ${PGHOST}:${PGPORT}"
  return 1
}

# ────── Backend: Docker ──────────────────────────────────────────────────

docker_up()    { log "starting Postgres via docker-compose";   docker compose up -d postgres; wait_for_pg; }
docker_down()  { log "stopping Postgres via docker-compose";   docker compose down; }
docker_reset() { log "destroying Postgres volume via docker";  docker compose down -v; docker_up; }

# ────── Backend: System cluster ──────────────────────────────────────────

sys_pgctl() {
  # Find any installed cluster; default to 16/main.
  local ver="${PG_CLUSTER_VERSION:-16}" name="${PG_CLUSTER_NAME:-main}"
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    pg_ctlcluster "$ver" "$name" "$1" 2>&1 || true
  else
    err "neither docker nor pg_ctlcluster found — install Postgres or Docker"
    return 1
  fi
}

sys_ensure_role_and_db() {
  # Create role + DB if absent. Requires sudo or postgres-OS-user access.
  local sql
  sql="$(cat <<EOF
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PGUSER}') THEN
    CREATE ROLE ${PGUSER} LOGIN PASSWORD '${PGPASSWORD}';
  END IF;
END
\$\$;
EOF
)"
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    echo "$sql" | sudo -u postgres psql -v ON_ERROR_STOP=1 -q -X
    sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PGDATABASE}'" \
      | grep -q 1 || sudo -u postgres createdb -O "$PGUSER" "$PGDATABASE"
  elif [[ "$(whoami)" == "root" ]]; then
    su - postgres -c "psql -v ON_ERROR_STOP=1 -q -X" <<<"$sql"
    su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${PGDATABASE}'\"" \
      | grep -q 1 || su - postgres -c "createdb -O ${PGUSER} ${PGDATABASE}"
  else
    log "no privileged access; assuming role/DB already exist"
  fi
}

sys_up()    { log "starting system Postgres cluster"; sys_pgctl start; wait_for_pg; sys_ensure_role_and_db; }
sys_down()  { log "stopping system Postgres cluster"; sys_pgctl stop; }
sys_reset() {
  log "dropping and recreating database ${PGDATABASE}"
  if [[ "$(whoami)" == "root" ]]; then
    su - postgres -c "dropdb --if-exists ${PGDATABASE}"
    su - postgres -c "createdb -O ${PGUSER} ${PGDATABASE}"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo -u postgres dropdb --if-exists "$PGDATABASE"
    sudo -u postgres createdb -O "$PGUSER" "$PGDATABASE"
  else
    psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  fi
}

# ────── Public ops ───────────────────────────────────────────────────────

cmd_up()      { if docker_available; then docker_up;    else sys_up;    fi; }
cmd_down()    { if docker_available; then docker_down;  else sys_down;  fi; }
cmd_reset()   { if docker_available; then docker_reset; else sys_reset; fi; cmd_migrate; }

cmd_migrate() {
  wait_for_pg
  if [[ ${#MIGRATION_FILES[@]} -eq 0 ]]; then
    err "no migrations in $MIGRATION_DIR"; return 1
  fi
  for f in "${MIGRATION_FILES[@]}"; do
    log "applying migration: $(basename "$f")"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X -f "$f"
  done
  log "all migrations applied"
}

cmd_status() {
  if docker_available; then
    docker compose ps postgres || true
  fi
  if pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then
    log "postgres is accepting connections on ${PGHOST}:${PGPORT}"
  else
    log "postgres NOT ready on ${PGHOST}:${PGPORT}"
  fi
}

case "${1:-}" in
  up)      cmd_up      ;;
  down)    cmd_down    ;;
  reset)   cmd_reset   ;;
  migrate) cmd_migrate ;;
  status)  cmd_status  ;;
  *)       echo "usage: $0 {up|down|reset|migrate|status}"; exit 2 ;;
esac

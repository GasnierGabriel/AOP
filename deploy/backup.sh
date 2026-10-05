#!/usr/bin/env bash
# Sauvegarde quotidienne de la base (cron), conservation 14 jours
set -euo pipefail

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
mkdir -p "$BACKUP_DIR"

FILE="$BACKUP_DIR/arece_db-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U arece -d arece_db | gzip > "$FILE"
find "$BACKUP_DIR" -name 'arece_db-*.sql.gz' -mtime +14 -delete

echo "Sauvegarde OK : $FILE"

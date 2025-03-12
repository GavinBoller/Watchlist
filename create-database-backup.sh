#!/bin/bash

# Get timestamp for the backup file name
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="database_backup_${TIMESTAMP}.sql"

# Extract connection info from DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL environment variable is not set."
  exit 1
fi

# Parse the DATABASE_URL
# Format: postgres://username:password@hostname:port/database_name
regex="postgres://([^:]+):([^@]+)@([^:]+):([^/]+)/(.+)"
if [[ $DATABASE_URL =~ $regex ]]; then
  DB_USER="${BASH_REMATCH[1]}"
  DB_PASS="${BASH_REMATCH[2]}"
  DB_HOST="${BASH_REMATCH[3]}"
  DB_PORT="${BASH_REMATCH[4]}"
  DB_NAME="${BASH_REMATCH[5]}"
else
  echo "ERROR: Could not parse DATABASE_URL."
  exit 1
fi

# Create a temporary password file (more secure than passing password on command line)
PGPASSFILE=$(mktemp)
echo "$DB_HOST:$DB_PORT:$DB_NAME:$DB_USER:$DB_PASS" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
export PGPASSFILE

echo "Creating backup of database $DB_NAME..."
echo "Host: $DB_HOST"
echo "Port: $DB_PORT"
echo "User: $DB_USER"
echo "Output file: $BACKUP_FILE"

# Perform the backup
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -F p -f "$BACKUP_FILE"
RESULT=$?

# Clean up
rm -f "$PGPASSFILE"

if [ $RESULT -eq 0 ]; then
  echo "Backup completed successfully to $BACKUP_FILE"
  echo "Size: $(du -h "$BACKUP_FILE" | cut -f1)"
else
  echo "Backup failed with error code $RESULT"
  exit $RESULT
fi

#!/bin/bash

# Check if backup file is provided
if [ -z "$1" ]; then
  echo "Usage: $0 <backup_file.sql>"
  echo "Please provide the backup file to restore."
  exit 1
fi

BACKUP_FILE="$1"

# Check if file exists
if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file '$BACKUP_FILE' not found."
  exit 1
fi

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

echo "WARNING: This will overwrite the current database with the backup."
echo "Database: $DB_NAME"
echo "Host: $DB_HOST"
echo "Port: $DB_PORT"
echo "User: $DB_USER" 
echo "Backup file: $BACKUP_FILE"
echo ""
echo "Are you sure you want to proceed? (y/N)"
read -r confirmation

if [[ ! "$confirmation" =~ ^[Yy]$ ]]; then
  echo "Restore cancelled."
  rm -f "$PGPASSFILE"
  exit 0
fi

echo "Restoring database from backup..."

# Restore the database
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$BACKUP_FILE"
RESULT=$?

# Clean up
rm -f "$PGPASSFILE"

if [ $RESULT -eq 0 ]; then
  echo "Restore completed successfully."
else
  echo "Restore failed with error code $RESULT"
  exit $RESULT
fi

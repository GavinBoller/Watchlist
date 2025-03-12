# How to Clean Production Data

This guide explains how to clean up the production database while retaining only specific users and their data. The process uses SQL transactions to safely delete unwanted data.

## Overview of Data Cleanup

The cleanup process will:
1. Preserve users with IDs 1, 30, 54, and 55, along with all their data
2. Delete all other users and their associated data (watchlist entries, platforms)
3. Clean up any session data for deleted users

## Backup First!

**IMPORTANT**: Always create a backup of your production database before running any cleanup scripts.

```bash
# Example using pg_dump (replace credentials with your actual values)
pg_dump -U your_username -h your_host -d your_database -f backup_before_cleanup.sql
```

## Testing the Cleanup Process

Before running the main cleanup script, you can use `test-cleanup.sql` to see what would be affected without making any changes:

```bash
psql -U your_username -h your_host -d your_database -f test-cleanup.sql
```

This will show you how many users, watchlist entries, and platforms would be deleted, but will roll back the transaction so no actual changes are made.

## Running the Cleanup Process

When you're ready to perform the actual cleanup:

1. Connect to your production database:
   ```bash
   psql -U your_username -h your_host -d your_database
   ```

2. Run the cleanup script:
   ```bash
   \i cleanup-production-data.sql
   ```

3. The script will:
   - Start a transaction
   - Show you what data will be affected
   - Delete the unwanted data
   - Show you the final state
   - Commit the changes

4. If you see any unexpected results when it shows the "BEFORE CLEANUP" statistics, you can manually abort by typing:
   ```sql
   ROLLBACK;
   ```

## In Case of Problems

If you encounter issues during the cleanup, the transaction will automatically roll back, protecting your data. If you need to restore from backup, use:

```bash
psql -U your_username -h your_host -d your_database -f backup_before_cleanup.sql
```

## Data That Will Be Removed

Based on the current database state, this cleanup will:
- Delete ~51 users (keeping only 4 specific users)
- Delete ~74 watchlist entries (keeping ~44 entries)
- Delete ~9 platforms (keeping ~5 platforms)
- Clean up associated session data for deleted users
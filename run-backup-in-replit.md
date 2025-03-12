# How to Create and Restore Database Backups in Replit

This guide explains how to use SQL scripts to create database backups directly from Replit, without needing external tools like `pg_dump`.

## Creating a Backup

To create a backup of your database before cleaning up data:

1. Run the SQL script from the Replit console:

```bash
node -e "const { Client } = require('pg'); const client = new Client(); client.connect().then(() => { console.log('Connected to database'); return client.query(require('fs').readFileSync('./create-backup.sql', 'utf8')); }).then(result => { console.log('Backup completed successfully'); console.table(result.rows); client.end(); }).catch(err => { console.error('Error creating backup:', err); client.end(); });"
```

OR

2. You can also directly execute the SQL in our provided execute_sql_tool:
   - Open the SQL tool
   - Copy and paste the contents of `create-backup.sql`
   - Run the query

The script will:
- Create backup tables with names like `users_backup_before_cleanup`
- Copy all data to these backup tables
- Show how many records were backed up

## Running the Data Cleanup

After creating your backup, you can proceed with the data cleanup:

1. First, run the test script to see what will be affected (without making changes):

```bash
node -e "const { Client } = require('pg'); const client = new Client(); client.connect().then(() => { console.log('Connected to database'); return client.query(require('fs').readFileSync('./test-cleanup.sql', 'utf8')); }).then(result => { console.log('Test completed successfully'); console.table(result.rows); client.end(); }).catch(err => { console.error('Error during test:', err); client.end(); });"
```

OR

2. Use the execute_sql_tool with the contents of `test-cleanup.sql`

3. When ready to perform the actual cleanup:

```bash
node -e "const { Client } = require('pg'); const client = new Client(); client.connect().then(() => { console.log('Connected to database'); return client.query(require('fs').readFileSync('./cleanup-production-data.sql', 'utf8')); }).then(result => { console.log('Cleanup completed successfully'); console.table(result.rows); client.end(); }).catch(err => { console.error('Error during cleanup:', err); client.end(); });"
```

OR

4. Use the execute_sql_tool with the contents of `cleanup-production-data.sql`

## Restoring from Backup (If Needed)

If something goes wrong and you need to restore:

```bash
node -e "const { Client } = require('pg'); const client = new Client(); client.connect().then(() => { console.log('Connected to database'); return client.query(require('fs').readFileSync('./restore-from-backup.sql', 'utf8')); }).then(result => { console.log('Restore completed successfully'); console.table(result.rows); client.end(); }).catch(err => { console.error('Error during restore:', err); client.end(); });"
```

OR

Use the execute_sql_tool with the contents of `restore-from-backup.sql`

## Important Notes

- The backup tables remain in your database (they are not automatically deleted)
- This is an "in-database" backup, not a separate file backup
- If you need to free up space later, you can drop the backup tables:

```sql
DROP TABLE IF EXISTS users_backup_before_cleanup;
DROP TABLE IF EXISTS watchlist_entries_backup_before_cleanup;
DROP TABLE IF EXISTS platforms_backup_before_cleanup;
DROP TABLE IF EXISTS movies_backup_before_cleanup;
DROP TABLE IF EXISTS session_backup_before_cleanup;
```
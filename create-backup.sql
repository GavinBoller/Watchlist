-- SQL script to create a backup of important tables
-- Run this script before any data cleanup to create a backup

-- Create backup tables with timestamps
BEGIN;

CREATE TABLE IF NOT EXISTS users_backup_before_cleanup AS 
SELECT *, NOW() as backup_timestamp FROM users;

CREATE TABLE IF NOT EXISTS watchlist_entries_backup_before_cleanup AS 
SELECT *, NOW() as backup_timestamp FROM watchlist_entries;

CREATE TABLE IF NOT EXISTS platforms_backup_before_cleanup AS 
SELECT *, NOW() as backup_timestamp FROM platforms;

CREATE TABLE IF NOT EXISTS movies_backup_before_cleanup AS 
SELECT *, NOW() as backup_timestamp FROM movies;

CREATE TABLE IF NOT EXISTS session_backup_before_cleanup AS 
SELECT *, NOW() as backup_timestamp FROM session;

-- Count the backed up records
SELECT 'Users backed up' as table_name, COUNT(*) as count FROM users_backup_before_cleanup
UNION ALL
SELECT 'Watchlist entries backed up', COUNT(*) FROM watchlist_entries_backup_before_cleanup
UNION ALL 
SELECT 'Platforms backed up', COUNT(*) FROM platforms_backup_before_cleanup
UNION ALL
SELECT 'Movies backed up', COUNT(*) FROM movies_backup_before_cleanup
UNION ALL
SELECT 'Sessions backed up', COUNT(*) FROM session_backup_before_cleanup;

COMMIT;
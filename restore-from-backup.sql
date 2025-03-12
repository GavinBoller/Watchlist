-- SQL script to restore data from backup tables
-- Run this only if you need to revert the cleanup process

BEGIN;

-- First, delete all current data
DELETE FROM watchlist_entries;
DELETE FROM platforms;
DELETE FROM users;
DELETE FROM session;

-- Now restore from backups
INSERT INTO users SELECT id, username, password, email, display_name, created_at, updated_at, profile_image 
FROM users_backup_before_cleanup;

INSERT INTO watchlist_entries SELECT id, user_id, movie_id, status, notes, platform_id, created_at, updated_at, rating
FROM watchlist_entries_backup_before_cleanup;

INSERT INTO platforms SELECT id, user_id, name, color, icon, url, is_default, created_at, updated_at
FROM platforms_backup_before_cleanup;

INSERT INTO session SELECT sid, sess, expire
FROM session_backup_before_cleanup;

-- Count the restored records
SELECT 'Users restored' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'Watchlist entries restored', COUNT(*) FROM watchlist_entries
UNION ALL 
SELECT 'Platforms restored', COUNT(*) FROM platforms
UNION ALL
SELECT 'Sessions restored', COUNT(*) FROM session;

COMMIT;
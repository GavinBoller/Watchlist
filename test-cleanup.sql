-- Script to safely test cleanup process without changing data
BEGIN;

-- Show what would be affected
SELECT 'Users to delete' as entity, COUNT(*) as count FROM users WHERE id NOT IN (1, 30, 54, 55);
SELECT 'Watchlist entries to delete' as entity, COUNT(*) as count FROM watchlist_entries WHERE user_id NOT IN (1, 30, 54, 55);
SELECT 'Platforms to delete' as entity, COUNT(*) as count FROM platforms WHERE user_id NOT IN (1, 30, 54, 55);

-- Test queries only without actually deleting anything
-- ROLLBACK at the end ensures no changes are made
ROLLBACK;

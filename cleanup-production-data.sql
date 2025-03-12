-- SQL Script to clean production data while preserving specific users and their data
-- THIS SCRIPT WILL DELETE DATA - RUN WITH CAUTION
-- Users to preserve: 1, 30, 54, 55

-- Start a transaction to ensure all operations complete or none at all
BEGIN;

-- Create a summary of what data will be affected
SELECT 'BEFORE CLEANUP - Total users' as entity, COUNT(*) as count FROM users
UNION ALL
SELECT 'BEFORE CLEANUP - Users to keep', COUNT(*) FROM users WHERE id IN (1, 30, 54, 55)
UNION ALL
SELECT 'BEFORE CLEANUP - Users to delete', COUNT(*) FROM users WHERE id NOT IN (1, 30, 54, 55)
UNION ALL
SELECT 'BEFORE CLEANUP - Total watchlist entries', COUNT(*) FROM watchlist_entries
UNION ALL
SELECT 'BEFORE CLEANUP - Watchlist entries to keep', COUNT(*) FROM watchlist_entries WHERE user_id IN (1, 30, 54, 55)
UNION ALL
SELECT 'BEFORE CLEANUP - Watchlist entries to delete', COUNT(*) FROM watchlist_entries WHERE user_id NOT IN (1, 30, 54, 55)
UNION ALL
SELECT 'BEFORE CLEANUP - Total platforms', COUNT(*) FROM platforms
UNION ALL
SELECT 'BEFORE CLEANUP - Platforms to keep', COUNT(*) FROM platforms WHERE user_id IN (1, 30, 54, 55)
UNION ALL
SELECT 'BEFORE CLEANUP - Platforms to delete', COUNT(*) FROM platforms WHERE user_id NOT IN (1, 30, 54, 55);

-- Create temporary table to store movies that should be preserved
-- These are movies that are referenced by watchlist entries of users we want to keep
CREATE TEMP TABLE movies_to_keep AS
SELECT DISTINCT m.id
FROM movies m
JOIN watchlist_entries w ON m.id = w.movie_id
WHERE w.user_id IN (1, 30, 54, 55);

-- Create temporary table to store platforms that belong to users we want to keep
CREATE TEMP TABLE platforms_to_keep AS
SELECT id FROM platforms WHERE user_id IN (1, 30, 54, 55);

-- First, clear any session data for users we're going to delete
-- This helps avoid foreign key conflicts with session data
DELETE FROM session
WHERE sess::jsonb->>'userId' IS NOT NULL 
AND (sess::jsonb->>'userId')::int NOT IN (1, 30, 54, 55);

-- Delete watchlist entries for users we don't want to keep
DELETE FROM watchlist_entries
WHERE user_id NOT IN (1, 30, 54, 55);

-- Delete platforms for users we don't want to keep
DELETE FROM platforms
WHERE user_id NOT IN (1, 30, 54, 55);

-- Now delete users we don't want to keep
DELETE FROM users
WHERE id NOT IN (1, 30, 54, 55);

-- Get a count of remaining data for verification
SELECT 'AFTER CLEANUP - Users remaining' as entity, COUNT(*) as count FROM users
UNION ALL
SELECT 'AFTER CLEANUP - Watchlist entries remaining', COUNT(*) FROM watchlist_entries
UNION ALL
SELECT 'AFTER CLEANUP - Platforms remaining', COUNT(*) FROM platforms;

-- If everything looks good, commit the transaction
COMMIT;

-- If you need to rollback, you can run:
-- ROLLBACK;
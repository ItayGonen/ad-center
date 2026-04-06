-- Migration: Rename price_per_day to price_per_hour in spaces table
-- Run this against the MySQL database before deploying the new code.

ALTER TABLE spaces CHANGE COLUMN price_per_day price_per_hour DOUBLE NOT NULL;

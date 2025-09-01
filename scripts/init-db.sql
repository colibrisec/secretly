-- Initial database setup for Secretly
-- This script is run automatically when the PostgreSQL container starts

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Grant permissions to the application user
GRANT ALL PRIVILEGES ON DATABASE secretly TO secretly_user;
GRANT ALL ON SCHEMA public TO secretly_user;
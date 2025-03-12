# Movie Watchlist Admin Configuration Guide

This document provides detailed instructions for configuring the administrative features of the Movie Watchlist application.

## Environment-Based Configuration

The application supports two primary environments:
- `development`: Used for local development and testing
- `production`: Used for deployed applications

### Setting Environment

The environment is determined through these methods (in order of precedence):
1. `FORCE_ENVIRONMENT` environment variable (if set)
2. `NODE_ENV` environment variable
3. Detection of deployment indicators

## Admin Access Control

### Configuring Admin Users

Admin access is granted to:
1. Users with specific IDs listed in `ADMIN_IDS`
2. Users with specific usernames listed in `ADMIN_USERNAMES`

```
# .env file example
ADMIN_IDS=1,30,55
ADMIN_USERNAMES=Gavinadmin,Gaju
```

By default, user IDs 1 and 30, and usernames 'Gavinadmin' and 'Gaju' have admin access.

## Environment-Specific Data Filtering

The dashboard can be configured to show different data in development vs. production environments.

### Username Pattern Filtering

Define SQL patterns to filter which users are shown in each environment:

```
# .env file example
DEV_USERNAME_PATTERN='dev_%'    # Only show users with names like 'dev_user1'
PROD_USERNAME_PATTERN='prod_%'  # Only show users with names like 'prod_user1'
```

By default:
- In development: excludes users with names like 'Gaju%' or 'Sophieb%'
- In production: only includes users with names like 'Gaju%' or 'Sophieb%'

## Dashboard Features

The admin dashboard provides:
1. User activity monitoring
2. Content statistics (movies, TV shows, watchlist entries)
3. System status information

### Access

The dashboard is available at `/admin` and requires admin authentication.

### Data Segregation

All dashboard data is correctly labeled with its source environment (`development` or `production`) to prevent confusion when viewing metrics.

## Configuration Quick Reference

| Environment Variable    | Purpose                                      | Default Value      |
|-------------------------|----------------------------------------------|--------------------|
| NODE_ENV                | Set application environment                  | 'development'      |
| FORCE_ENVIRONMENT       | Override environment for dashboard           | None               |
| ADMIN_IDS               | User IDs with admin access                   | [1, 30]            |
| ADMIN_USERNAMES         | Usernames with admin access                  | ['Gavinadmin', 'Gaju'] |
| DEV_USERNAME_PATTERN    | SQL pattern for dev user filtering           | None (uses exclusion) |
| PROD_USERNAME_PATTERN   | SQL pattern for production user filtering    | None (uses inclusion) |
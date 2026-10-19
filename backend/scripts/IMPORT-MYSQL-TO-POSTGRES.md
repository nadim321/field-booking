# One-time MySQL to PostgreSQL import

This command copies application rows from the old MySQL database into an empty PostgreSQL database. It is never run by application startup or deployment. Run it from a trusted machine with network access to both databases.

## Before importing

1. Put the old booking/payment service in maintenance mode and stop all writes. Keep it stopped through verification so no bookings or payments are missed.
2. Take a complete MySQL backup and verify that the backup can be read. Keep a recoverable copy of the old database.
3. Make sure both databases have all current migrations (`001` through `009`). The importer checks `schema_migrations` and refuses to proceed if either schema is behind. Apply any missing schema migrations only after the verified backup.
4. Keep the target PostgreSQL database empty. It may contain only the initial `branding_lock=1` setting created by the PostgreSQL migrations.
5. If `venue_media` has rows, copy the old service's persistent media files to a directory accessible to the import machine and set `SOURCE_MEDIA_DIR`. Set `MEDIA_DIR` to the target service's persistent media directory. The importer checks filenames and copies their bytes; SQL alone does not include those files.

## Configure and preview

From `backend/`, configure the target connection using `DB_DRIVER=postgres` and `DATABASE_URL` (or the PostgreSQL `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, and `DB_NAME` values). Set `DB_SSL=true` when required. Also set these source-only variables in the local shell:

```text
SOURCE_MYSQL_HOST
SOURCE_MYSQL_PORT
SOURCE_MYSQL_USER
SOURCE_MYSQL_PASSWORD
SOURCE_MYSQL_DATABASE
SOURCE_MEDIA_DIR   # only if venue_media has files
```

Do not commit credentials or put source credentials in Render. The project `.env` is loaded for target settings; shell environment variables take precedence. Run the non-writing preview first:

```sh
npm run import:mysql-to-postgres -- --dry-run
```

It reports row counts only and checks target emptiness, tables, and migration versions. It does not display row contents or credentials.

## Import

After reviewing the preview, confirming the source backup, and confirming source writes remain stopped, run:

```sh
npm run import:mysql-to-postgres -- --apply --confirm-writes-paused --backup-verified
```

The importer preserves IDs, copies tables in dependency order in one PostgreSQL transaction, resets serial sequences, copies venue media, and compares row counts before committing. On an error, it rolls back the database transaction and removes media files it copied. Keep both services in maintenance mode until the final report has no error; then verify the site and re-enable the PostgreSQL service. The old MySQL service and its verified backup should be retained until the migrated data has been checked.

The importer refuses to merge with existing target application rows. To retry after a failed run, first confirm the database transaction rolled back and remove any partial state only after reviewing the database; do not drop or truncate production data blindly.

# Venue branding and uploaded images

Open **Admin → Field Configuration** (`/admin/dashboard/field-configuration`). Enter the real name, address, phone, email, separate WhatsApp number, Google Maps location link, description and facilities (one per line). Upload a logo and up to eight field photos, add descriptive captions, and use the arrow buttons to choose the order. The first photo is the cover. **Save Settings** publishes the draft; removing an image or changing its order also requires saving.

**Admin → Slot Setup** (`/admin/dashboard/slot-setup`) is a separate page for slot times, prices, categories, active status, add/edit/delete and **Required advance payment (%)**. Save the percentage with **Save Advance Payment**. Field Configuration saves only branding fields; the advance form saves only its percentage, so neither overwrites the other page's settings. Both URLs require admin login and support reload and browser history. Save your draft before leaving a page.

Only actual venue photographs should be uploaded. No venue facts or stock images are supplied. Empty fields stay hidden; the neutral unconfigured name is “Turf Booking”. Review any old demo values already stored in your database; this migration deliberately does not overwrite them. Booking and season pages, admin branding, current-year footer, page metadata, booking PDF and notification contact details use the same settings. A missing logo does not block PDF download. An unavailable settings API shows a retry message instead of fabricated information. Client-side metadata is updated after loading; server-rendered SEO/social previews are not included.

## API and data

- Migration **005-venue-branding.js** widens `app_settings.setting_value` to TEXT and creates `venue_media`. It is restart-safe and leaves existing business information intact. Migration 004 remains required.
- Existing GET `/api/settings/public`, GET `/api/admin/settings` and PUT `/api/admin/settings` remain compatible. New fields: `turf_whatsapp`, `turf_maps_url`, `turf_description`, `turf_facilities` (string array), `turf_logo_id` (UUID or null), `turf_photos` (ordered `{id, caption}` array). GET also returns `turf_logo` and photo `url`, `width`, `height`, `kind`. Paths on disk and internal settings are not exposed. Public settings include the existing cancellation policy.
- PUT validates the entire change before writing, and saves it transactionally. Blank strings clear optional text fields. Phone inputs accept Bangladesh mobiles or international numbers and normalize to an international format. Maps links require HTTPS Google Maps hosts; arbitrary URLs and iframe HTML are rejected. Maps opens externally, not embedded.
- POST `/api/admin/media?kind=logo|photo` requires admin authentication and a **raw image body**, with JPEG/PNG/WebP Content-Type. The frontend sends the selected File directly, not multipart form data. Limit: 5 MiB, 25 megapixels, dimensions no larger than 10,000 pixels, no animation. Images are decoded and re-encoded, orientation applied, metadata removed; logos become PNG up to 512×512, photos WebP up to 1920×1920. Original filenames are ignored.
- GET `/api/media/:id` serves normalized images with `nosniff`. UUID preview URLs are public, including uploads not yet published. DELETE `/api/admin/media/:id` is admin-only and refuses any referenced image (409). Save its removal from settings first.

## Persistent storage and deployment

Set **MEDIA_DIR** to an absolute persistent directory outside the backend release, for example `/var/lib/booking/media`, owned and writable by the application user. Production startup requires this setting. Development defaults to the repository's ignored `media/` directory. Multiple application replicas must share this directory; ephemeral container storage is unsuitable. Media files are never packaged in the release ZIP.

1. Stop old application writers, recurring schedulers and media cleanup jobs.
2. Back up before migrating. Install dependencies including Sharp with `npm ci --prefix backend`; run migrations through 005 and `migrate:check` using the deployment runbook.
3. Configure persistent storage, start the new release, check readiness, then upload and publish real venue details.
4. Verify one public image, the footer and a PDF before ending maintenance.

No migration, deployment or real contact setup is performed by the tests. Tests create temporary databases and media directories. Pre-004 writers cannot use the current schema; do not roll back blindly.

## Backup, restore and cleanup

**Stop application writers, uploads and cleanup for the entire backup operation.** MySQL's consistent snapshot alone does not synchronize files on disk. `npm run backup --prefix backend` now creates three related artifacts: `NAME.sql.gz`, `NAME.sql.gz.json` and (for schema 005+) `NAME.sql.gz.media/`. The manifest contains per-image checksums and sizes. Preserve/copy all three together with restricted permissions. A missing registered image fails backup; never treat a partial backup as complete.

Restore with `MEDIA_DIR` pointing to a new, empty destination and the usual empty target database:

```bash
MEDIA_DIR=/var/lib/booking/restored-media npm run restore --prefix backend -- /backups/NAME.sql.gz empty_target_database --confirm=empty_target_database
```

Restore validates the SQL and every image checksum before importing, refuses nonempty media/database targets and never overwrites existing media. After success, set both DB_NAME and MEDIA_DIR to the restored pair, verify public images/settings/PDF, then switch traffic. An interrupted restore may leave a partially populated target; diagnose and restore into another empty pair. Backups from before 005 have no media component.

Schedule `npm run media:cleanup --prefix backend` daily with the same DB and MEDIA_DIR configuration, outside backup/restore windows. It removes unreferenced uploads older than 24 hours and old orphaned image files left by interrupted uploads. Published images are retained. A draft left unsaved beyond that window may need re-uploading. Removing a photo from the site does not immediately erase cached copies or backups.

Validation: backend and Angular tests; `RUN_DB_TESTS=1 RUN_BACKUP_TESTS=1 npm run test:integration --prefix backend`; production frontend build; browser suite after the build. MySQL client paths can be set with MYSQL_BIN and MYSQLDUMP_BIN. The integration suite tests real database/media backup and isolated restore; browser tests cover upload, publish, reorder/remove, mobile layout and failure states.

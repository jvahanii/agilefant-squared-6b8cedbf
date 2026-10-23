# Architecture rules

- Route build updates and stale-chunk recovery through `src/lib/appVersion.ts` using cache-busting document navigation; ordinary reloads can reuse obsolete HTML. Keep automatic error recovery rate-limited in session storage and allow manual recovery without storage.
- Edit work-item descriptions through the shared description dialog and the app-store mutation; existing work-item persistence and Jira reconciliation carry the field in both directions.
- Jira ADF documents must put `version: 1` at the document root; test the API document shape, since text round trips alone do not establish Jira accepts it.
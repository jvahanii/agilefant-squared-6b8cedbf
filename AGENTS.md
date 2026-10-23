# Architecture rules

- Route build updates and stale-chunk recovery through `src/lib/appVersion.ts` using cache-busting document navigation; ordinary reloads can reuse obsolete HTML. Keep automatic error recovery rate-limited in session storage and allow manual recovery without storage.
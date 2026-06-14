Create a file at `public/_redirects` containing the following single line to enable SPA client-side routing on Cloudflare Pages:

```
/* /index.html 200
```

This ensures all unmatched routes serve `index.html` with a 200 status, allowing React Router to handle deep links on Cloudflare Pages hosting.

Note: This file only affects Cloudflare Pages (and Netlify) deployments. Lovable's own hosting already provides automatic SPA fallback at the infrastructure level, so this file is not needed for the current `.lovable.app` URLs.
# Security and deployment checklist

- Keep `.env` out of version control. Rotate Spotify, Last.fm, and session
  secrets right away if they're ever exposed.
- Set `NODE_ENV=production`, use an HTTPS `PUBLIC_ORIGIN`, and set a random
  `SESSION_SECRET` of at least 32 characters before deployment.
- Only set `TRUST_PROXY=true` when the app is behind a proxy you control.
  The app redirects HTTP to HTTPS when `REQUIRE_HTTPS=true`.
- Spotify data routes need a Spotify login. Mutating requests need the CSRF
  token. Uploads are limited to bounded ZIP files.
- No CORS middleware is enabled. Requests from an origin other than
  `PUBLIC_ORIGIN` are rejected.
- There's no database or admin routes. Tokens and analysis data live in
  process memory. Not suitable for a public multi-user service as it is.
- Spotify and Last.fm don't charge this app directly, but provider quotas
  and account limits still apply. Set your own spending and alert limits
  outside this application.

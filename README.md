# Spotify Last.fm Library Cleaner

Finds tracks and playlists in your Spotify library you haven't listened to
in years. Uses your Last.fm scrobble history or a Spotify data export to
work out which tracks are old and unplayed. You review the results and pick what to remove.
Nothing is changed until you confirm.

## Status

Working end-to-end for personal use. Spotify login, Last.fm sync with live
progress, Spotify export upload, old track detection, and a review screen
that only removes what you select. Has a test suite for auth, matching, and
playlist logic. Not built for multi-user or public deployment yet. See
Notes below.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your real values:
   ```
   cp .env.example .env
   ```
   Get your Client ID and Client Secret from
   https://developer.spotify.com/dashboard (your app, then Settings).

3. In the Spotify dashboard, set the app's Redirect URI to exactly:
   ```
   http://127.0.0.1:3000/callback
   ```
   This has to match `.env` exactly, including http vs https and trailing
   slashes.

4. Run the server:
   ```
   npm start
   ```

5. Open http://127.0.0.1:3000 and click "Log in with Spotify."

6. After approving access you should land back on the analysis screen.

7. Pick Liked Songs or a playlist, then pick Last.fm or a Spotify export ZIP
   as the history source.

### Last.fm sync

Create a Last.fm API application at https://www.last.fm/api/account/create
and add the API key as `LASTFM_API_KEY` in `.env`. Start a sync by posting a
Last.fm username:

macOS / Linux / Git Bash:
```bash
curl -X POST http://127.0.0.1:3000/lastfm/sync \
  -H "Content-Type: application/json" \
  -d '{"username":"your_lastfm_username"}'
```

Windows (cmd.exe):
```cmd
curl -X POST http://127.0.0.1:3000/lastfm/sync ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"your_lastfm_username\"}"
```

The response is `202 Accepted` because the import runs in the background.
Poll `http://127.0.0.1:3000/lastfm/status` for progress: status, pages
fetched, unique tracks found. The result is stored in memory as
`lastFmHistory` and feeds the stale track matching.

### Spotify export source

Request Spotify's extended streaming history from
https://www.spotify.com/account/privacy/ and wait for the ZIP email. Upload
that ZIP on the analysis screen. The server reads the
`Streaming_History_Audio_*.json` files and ignores plays under ten seconds
as likely skips.

The review screen checks stale tracks by default. You can deselect any
track. Nothing is removed until you submit the review and confirm.

Spotify's Web API needs a logged in, authenticated token to read playlist
contents no matter how the playlist was shared. Log in as the playlist
owner, or make the playlist public. Removing tracks needs the
playlist-modification permission requested at login.

## Notes

- Security and deployment details are in [`SECURITY.md`](SECURITY.md).

## License

MIT. See [`LICENSE`](LICENSE). Change this if you want a different license.

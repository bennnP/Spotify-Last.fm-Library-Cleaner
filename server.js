require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI,
  LASTFM_API_KEY,
  STALE_AFTER_YEARS,
  PORT,
  SESSION_SECRET,
  NODE_ENV,
  PUBLIC_ORIGIN,
  MAX_UPLOAD_MB,
  RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_MAX,
  REQUIRE_HTTPS,
  TRUST_PROXY,
  SESSION_TTL_HOURS,
} = require('./src/config/env');
const store = require('./src/store');
const { fetchLastFmHistory, fetchLastFmProfile } = require('./src/services/lastfmService');
const { fetchSpotifyTarget, fetchSpotifyPlaylistDetails, fetchSpotifyPlaylists, parseSpotifyExport, ensureValidSpotifyAccessToken } = require('./src/services/spotifyService');
const { buildReviewTracks, trackKey } = require('./src/utils/trackMatching');
const { extractPlaylistId } = require('./src/utils/playlist');
const { normalizeLastFmUsername } = require('./src/utils/lastfm');

const app = express();
const isProduction = NODE_ENV === 'production';
const requestWindowMs = 60 * 1000;
const requestCounts = new Map();
const sessionTtlMs = SESSION_TTL_HOURS * 60 * 60 * 1000;

app.disable('x-powered-by');
app.set('trust proxy', TRUST_PROXY);

app.use((req, res, next) => {
  if (REQUIRE_HTTPS && !req.secure) {
    return res.redirect(`${PUBLIC_ORIGIN}${req.originalUrl}`);
  }
  return next();
});

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' https://i.scdn.co data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  next();
});

app.use(cookieParser(SESSION_SECRET));
app.use((req, res, next) => {
  let sessionId = req.signedCookies?.library_session;
  let session = sessionId ? store.sessions.get(sessionId) : null;
  if (!session || session.expiresAt <= Date.now()) {
    sessionId = crypto.randomBytes(32).toString('hex');
    session = {
      id: sessionId,
      createdAt: Date.now(),
      expiresAt: Date.now() + sessionTtlMs,
      tokenStore: { accessToken: null, refreshToken: null, expiresAt: null },
      lastFmJob: null,
      analysisJob: null,
    };
    store.sessions.set(sessionId, session);
    res.cookie('library_session', sessionId, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: sessionTtlMs,
    });
  } else {
    session.expiresAt = Date.now() + sessionTtlMs;
  }
  req.session = session;

  if (!req.cookies.csrf_token) {
    res.cookie('csrf_token', crypto.randomBytes(24).toString('hex'), {
      httpOnly: false,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 24 * 60 * 60 * 1000,
    });
  }

  const key = `${req.ip}:${req.path.startsWith('/login') || req.path.startsWith('/callback') ? 'auth' : 'app'}`;
  const now = Date.now();
  const entry = requestCounts.get(key);
  const limit = key.endsWith(':auth') ? AUTH_RATE_LIMIT_MAX : RATE_LIMIT_MAX;
  if (!entry || now - entry.startedAt >= requestWindowMs) {
    requestCounts.set(key, { startedAt: now, count: 1 });
  } else if (entry.count >= limit) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  } else {
    entry.count += 1;
  }
  return next();
});

app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && origin !== PUBLIC_ORIGIN) {
    return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  }
  return next();
});

app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(`${path.sep}index.html`)) {
      res.set('Cache-Control', 'no-store');
    }
  },
}));
app.use(express.json({ limit: '1mb' }));

function hasValidCsrfToken(req) {
  const cookieToken = req.cookies.csrf_token;
  const headerToken = req.get('X-CSRF-Token');
  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
}

function requireSpotifyAuth(req, res, next) {
  if (!req.session?.tokenStore?.accessToken && !req.session?.tokenStore?.refreshToken) {
    return res.status(401).json({ error: 'Log in with Spotify before accessing library data.' });
  }
  return next();
}

function cleanText(value, maxLength = 120) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

app.use((req, res, next) => {
  if (['POST', 'PATCH', 'DELETE'].includes(req.method) && !hasValidCsrfToken(req)) {
    return res.status(403).json({ error: 'Security check failed. Refresh the page and try again.' });
  }
  return next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 20 },
  fileFilter: (req, file, callback) => {
    const validName = /\.zip$/i.test(file.originalname);
    const validType = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(file.mimetype);
    callback(null, validName && validType);
  },
});

const SCOPES = [
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

function publicAnalysisJob(session) {
  if (!session.analysisJob) {
    return { status: 'idle' };
  }

  const { history, ...job } = session.analysisJob;
  return {
    ...job,
    staleTracks: job.tracks?.filter((track) => track.stale).length || 0,
    totalTracks: job.tracks?.length || 0,
  };
}

function publicLastFmJob(session) {
  if (!session.lastFmJob) {
    return { status: 'idle' };
  }

  const { history, ...job } = session.lastFmJob;
  return { ...job, tracksFound: history ? history.size : 0 };
}

function startLastFmSync(session, username) {
  session.lastFmJob = {
    status: 'running',
    username,
    pagesFetched: 0,
    totalPages: null,
    tracksScanned: 0,
    history: new Map(),
    profile: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  Promise.all([
    fetchLastFmProfile(username),
    fetchLastFmHistory(username, session.lastFmJob),
  ])
    .then(([profile, history]) => {
      session.lastFmJob.profile = profile;
      session.lastFmJob.history = history;
      session.lastFmJob.status = 'completed';
      session.lastFmJob.finishedAt = new Date().toISOString();
    })
    .catch((error) => {
      session.lastFmJob.status = 'failed';
      session.lastFmJob.finishedAt = new Date().toISOString();
      session.lastFmJob.error = 'Last.fm sync failed.';
      console.error('Last.fm sync failed:', error.message);
    });
}

function startAnalysis(session, { source, username, fileBuffer, target, staleAfterMonths }) {
  session.analysisJob = {
    status: 'running',
    source,
    target,
    staleAfterMonths,
    phase: 'target',
    tracksScanned: 0,
    filesProcessed: 0,
    totalFiles: null,
    tracksFetched: 0,
    totalTracks: null,
    tracks: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  (async () => {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - staleAfterMonths);

    session.analysisJob.phase = 'target';
    const tracks = await fetchSpotifyTarget(target, session.analysisJob, session.tokenStore);
    session.analysisJob.phase = 'history';

    const targetKeys = new Set(tracks.flatMap((track) => {
      const artists = Array.isArray(track.artists) && track.artists.length > 0
        ? track.artists
        : [track.artist];
      return artists.map((artist) => trackKey(artist, track.name));
    }));
    const history = source === 'lastfm'
      ? await fetchLastFmHistory(username, session.analysisJob, cutoffDate.toISOString(), targetKeys)
      : await parseSpotifyExport(fileBuffer, session.analysisJob);

    session.analysisJob.tracks = buildReviewTracks(tracks, history, null, staleAfterMonths);
    session.analysisJob.phase = 'review';
    session.analysisJob.status = 'completed';
    session.analysisJob.finishedAt = new Date().toISOString();
  })().catch((error) => {
    session.analysisJob.status = 'failed';
    session.analysisJob.finishedAt = new Date().toISOString();
    session.analysisJob.error = 'Analysis failed. Please try again.';
    console.error('Analysis failed:', session.analysisJob.error);
  });
}

app.post('/lastfm/sync', (req, res) => {
  const username = normalizeLastFmUsername(req.body?.username);

  if (!LASTFM_API_KEY) {
    return res.status(500).json({ error: 'LASTFM_API_KEY is not configured.' });
  }
  if (!username) {
    return res.status(400).json({ error: 'Provide a Last.fm username or a valid Last.fm profile URL.' });
  }
  if (req.session.lastFmJob?.status === 'running') {
    return res.status(409).json({ error: 'A Last.fm sync is already running.', job: publicLastFmJob(req.session) });
  }

  startLastFmSync(req.session, username);
  return res.status(202).json(publicLastFmJob(req.session));
});

app.get('/lastfm/status', (req, res) => {
  res.json(publicLastFmJob(req.session));
});

app.get('/lastfm/profile', async (req, res) => {
  const username = normalizeLastFmUsername(req.query.username);

  if (!LASTFM_API_KEY) {
    return res.status(500).json({
      error: 'Last.fm API key is missing. Add LASTFM_API_KEY to your .env file before using Last.fm.',
    });
  }
  if (!username) {
    return res.status(400).json({ error: 'Enter a Last.fm username or a valid Last.fm profile URL.' });
  }

  try {
    const profile = await fetchLastFmProfile(username);
    return res.json({ username, profile });
  } catch (error) {
    const detail = error.response?.data?.message || error.message;
    const cleanMessage = /user not found|not found/i.test(detail)
      ? 'We could not find that Last.fm profile. Check the username and try again.'
      : /api key|forbidden|invalid/i.test(detail)
        ? 'Last.fm rejected the request. Check your LASTFM_API_KEY and try again.'
        : 'Could not load this Last.fm profile. Check the username and try again.';

    console.error('Last.fm profile lookup failed:', detail || error.message);
    return res.status(400).json({ error: cleanMessage });
  }
});

app.get('/spotify/playlist', requireSpotifyAuth, async (req, res) => {
  const rawPlaylistId = cleanText(req.query.playlistId, 200);
  const playlistId = extractPlaylistId(rawPlaylistId);

  if (!playlistId) {
    return res.status(400).json({ error: 'Paste a valid Spotify playlist link or ID to confirm it exists.' });
  }
  if (!req.session.tokenStore.accessToken && !req.session.tokenStore.refreshToken) {
    return res.status(401).json({ error: 'Log in with Spotify before reading playlist contents.' });
  }
  try {
    const playlist = await fetchSpotifyPlaylistDetails(playlistId, req.session.tokenStore);
    return res.json({ playlist });
  } catch (error) {
    const message = error.response?.status === 401
      ? 'Your Spotify login has expired. Log in again and try the playlist again.'
      : error.response?.status === 403
        ? 'Spotify denied access to this playlist. Confirm that your account can open it, then try again.'
        : 'Could not load that Spotify playlist. Check the link or ID and try again.';

    console.error('Spotify playlist lookup failed:', error.response?.data || error.message);
    return res.status(400).json({ error: message });
  }
});

app.get('/spotify/playlists', requireSpotifyAuth, async (req, res) => {
  try {
    if (!req.session.tokenStore.refreshToken && !req.session.tokenStore.accessToken) {
      return res.status(401).json({ error: 'Log in with Spotify first.' });
    }

    const accessToken = await ensureValidSpotifyAccessToken(req.session.tokenStore);
    if (!accessToken) {
      return res.status(401).json({ error: 'Log in with Spotify first.' });
    }

    const playlists = await fetchSpotifyPlaylists(req.session.tokenStore);
    res.json(playlists);
  } catch (error) {
    const status = error.response?.status === 401 || /token|login/i.test(error.message) ? 401 : 500;
    res.status(status).json({ error: status === 401 ? 'Log in with Spotify first.' : 'Failed to fetch Spotify playlists.' });
  }
});

app.post('/analysis', requireSpotifyAuth, upload.single('historyZip'), (req, res) => {
  if (req.session.analysisJob?.status === 'running') {
    return res.status(409).json({ error: 'An analysis is already running.', job: publicAnalysisJob(req.session) });
  }

  const source = cleanText(req.body.source, 30);
  const username = normalizeLastFmUsername(req.body.username);
  const targetType = cleanText(req.body.targetType, 30);
  const staleAfterMonths = Number(req.body.staleAfterMonths || STALE_AFTER_YEARS * 12);
  const extractedPlaylistId = targetType === 'playlist' ? extractPlaylistId(req.body.playlistId) : null;
  const target = targetType === 'liked'
    ? { type: 'liked', name: 'Liked Songs' }
    : { type: 'playlist', id: extractedPlaylistId, name: cleanText(req.body.playlistName, 120) || 'Playlist' };

  if (!['lastfm', 'spotify-export'].includes(source)) {
    return res.status(400).json({ error: 'Choose lastfm or spotify-export as the history source.' });
  }
  if (!req.session.tokenStore.accessToken && !req.session.tokenStore.refreshToken) {
    return res.status(401).json({ error: 'Log in with Spotify before analyzing playlist contents or Liked Songs.' });
  }
  if (!['liked', 'playlist'].includes(targetType) || (targetType === 'playlist' && !target.id)) {
    return res.status(400).json({ error: 'Choose Liked Songs or provide a sharable Spotify playlist link or ID.' });
  }
  if (!Number.isInteger(staleAfterMonths) || staleAfterMonths <= 0) {
    return res.status(400).json({ error: 'The time period must be a positive whole number of months.' });
  }
  if (source === 'lastfm' && (!LASTFM_API_KEY || !username)) {
    return res.status(400).json({ error: 'Last.fm source requires LASTFM_API_KEY and a username or valid profile URL.' });
  }
  if (source === 'spotify-export' && !req.file) {
    return res.status(400).json({ error: 'Spotify export source requires a ZIP file.' });
  }
  if (req.file && !(req.file.buffer[0] === 0x50 && req.file.buffer[1] === 0x4b)) {
    return res.status(400).json({ error: 'Upload a valid ZIP archive.' });
  }

  startAnalysis(req.session, {
    source,
    username,
    fileBuffer: req.file?.buffer,
    target,
    staleAfterMonths,
  });

  return res.status(202).json(publicAnalysisJob(req.session));
});

app.get('/analysis/status', requireSpotifyAuth, (req, res) => {
  res.json(publicAnalysisJob(req.session));
});

app.patch('/analysis/review', requireSpotifyAuth, (req, res) => {
  if (!req.session.analysisJob || req.session.analysisJob.status !== 'completed') {
    return res.status(409).json({ error: 'Complete an analysis before submitting review choices.' });
  }

  const selectedIds = new Set(
    Array.isArray(req.body.selectedIds)
      ? req.body.selectedIds.filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id)).slice(0, 10000)
      : []
  );
  for (const track of req.session.analysisJob.tracks) {
    track.selected = selectedIds.has(track.id);
  }

  return res.json({ selectedForRemoval: req.session.analysisJob.tracks.filter((track) => track.selected).length });
});

app.delete('/analysis/selected', requireSpotifyAuth, async (req, res) => {
  if (!req.session.analysisJob || req.session.analysisJob.status !== 'completed') {
    return res.status(409).json({ error: 'Complete an analysis before removing tracks.' });
  }

  const selected = req.session.analysisJob.tracks.filter((track) => track.selected);
  if (selected.length === 0) {
    return res.json({ removed: 0 });
  }

  try {
    if (req.session.analysisJob.target.type === 'liked') {
      const accessToken = await ensureValidSpotifyAccessToken(req.session.tokenStore);
      await axios.delete('https://api.spotify.com/v1/me/tracks', {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { ids: selected.map((track) => track.id) },
      });
    } else {
      const accessToken = await ensureValidSpotifyAccessToken(req.session.tokenStore);
      await axios.delete(`https://api.spotify.com/v1/playlists/${encodeURIComponent(req.session.analysisJob.target.id)}/items`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { tracks: selected.map((track) => ({ uri: track.uri })) },
      });
    }

    req.session.analysisJob.tracks = req.session.analysisJob.tracks.filter((track) => !track.selected);
    return res.json({ removed: selected.length });
  } catch (error) {
    res.status(500).json({ error: 'Spotify could not remove the selected tracks.' });
  }
});

app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('spotify_auth_state', state, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 5 * 60 * 1000,
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state,
  });

  return res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
});

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const storedState = req.signedCookies ? req.signedCookies['spotify_auth_state'] : null;

  if (error) {
    return res.status(400).send('Spotify returned an error. Please try again.');
  }

  if (typeof code !== 'string' || code.length > 2048 || !state || state !== storedState) {
    return res.status(400).send('State mismatch — possible CSRF, or your cookie was blocked. Try /login again.');
  }

  try {
    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    req.session.tokenStore.accessToken = access_token;
    req.session.tokenStore.refreshToken = refresh_token;
    req.session.tokenStore.expiresAt = Date.now() + expires_in * 1000;

    return res.redirect('/');
  } catch (err) {
    console.error('Token exchange failed:', err.response?.data || err.message);
    return res.status(500).send('Something went wrong exchanging the code for a token. Check the server console.');
  }
});

app.get('/liked-songs', requireSpotifyAuth, async (req, res) => {
  try {
    const accessToken = await ensureValidSpotifyAccessToken(req.session.tokenStore);
    const response = await axios.get('https://api.spotify.com/v1/me/tracks', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 50 },
    });

    const tracks = response.data.items.map((item) => ({
      addedAt: item.added_at,
      name: item.track.name,
      artist: item.track.artists.map((artist) => artist.name).join(', '),
    }));

    return res.json({
      total: response.data.total,
      showing: tracks.length,
      tracks,
    });
  } catch (err) {
    console.error('Failed to fetch liked songs:', err.response?.data || err.message);
    return res.status(500).send('Failed to fetch liked songs. Check the server console.');
  }
});

app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});

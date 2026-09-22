const axios = require('axios');
const { tokenStore } = require('../store');
const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = require('../config/env');

const MIN_PLAY_MS = 10 * 1000;
const appTokenStore = {
  accessToken: null,
  expiresAt: 0,
};

async function ensureValidSpotifyAccessToken(userTokenStore = tokenStore) {
  if (!userTokenStore.accessToken || !userTokenStore.expiresAt || Date.now() >= userTokenStore.expiresAt - 60 * 1000) {
    if (!userTokenStore.refreshToken) {
      throw new Error('Missing/invalid/expired access token');
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
        refresh_token: userTokenStore.refreshToken,
      });

    const response = await axios.post('https://accounts.spotify.com/api/token', params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      },
    });

    userTokenStore.accessToken = response.data.access_token;
    userTokenStore.refreshToken = response.data.refresh_token || userTokenStore.refreshToken;
    userTokenStore.expiresAt = Date.now() + Number(response.data.expires_in || 3600) * 1000;
  }

  return userTokenStore.accessToken;
}

async function ensureSpotifyAppAccessToken() {
  if (appTokenStore.accessToken && Date.now() < appTokenStore.expiresAt - 60 * 1000) {
    return appTokenStore.accessToken;
  }

  const response = await axios.post('https://accounts.spotify.com/api/token', new URLSearchParams({
    grant_type: 'client_credentials',
  }), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
  });

  appTokenStore.accessToken = response.data.access_token;
  appTokenStore.expiresAt = Date.now() + Number(response.data.expires_in || 3600) * 1000;
  return appTokenStore.accessToken;
}

async function fetchSpotifyTarget(target, job, userTokenStore = tokenStore) {
  const tracks = [];
  let url = target.type === 'liked'
    ? 'https://api.spotify.com/v1/me/tracks'
    : `https://api.spotify.com/v1/playlists/${encodeURIComponent(target.id)}/items`;

  const isLikedSongs = target.type === 'liked';
  if (isLikedSongs && !userTokenStore.accessToken && !userTokenStore.refreshToken) {
    throw new Error('Spotify login is required to fetch Liked Songs.');
  }

  const hasUserToken = Boolean(userTokenStore.accessToken || userTokenStore.refreshToken);
  if (!isLikedSongs && !hasUserToken) {
    throw new Error('Spotify login is required to read playlist tracks.');
  }

  const accessToken = await ensureValidSpotifyAccessToken(userTokenStore);

  while (url) {
    const headers = { Authorization: `Bearer ${accessToken}` };

    try {
      const response = await axios.get(url, {
        headers,
        params: url.includes('/me/tracks') ? { limit: 50 } : { limit: 100 },
      });

      const items = Array.isArray(response.data.items) ? response.data.items : [];
      for (const item of items) {
        const track = item.track || item.item;
        if (!track || !track.id || track.is_local) {
          continue;
        }

        tracks.push({
          id: track.id,
          uri: track.uri,
          name: track.name,
          artists: track.artists.map((artist) => artist.name),
          artist: track.artists.map((artist) => artist.name).join(', '),
          albumImage: track.album?.images?.[0]?.url || null,
        });
      }

      job.tracksFetched = tracks.length;
      job.totalTracks = Number(response.data.total || 0);
      url = response.data.next;
    } catch (error) {
      if (target.type === 'playlist' && error.response?.status === 401) {
        throw new Error('Your Spotify login has expired. Log in again before analyzing this playlist.');
      }
      if (target.type === 'playlist' && [403, 404].includes(error.response?.status)) {
        throw new Error('Spotify denied access to this playlist. A shareable link does not grant API access to a private or unlisted playlist. Make it public, or log in as its owner and authorize playlist access.');
      }
      throw error;
    }


    await new Promise((resolve) => setImmediate(resolve));
  }

  return tracks;
}

async function fetchSpotifyPlaylistDetails(playlistId, userTokenStore = tokenStore) {
  const accessToken = await ensureValidSpotifyAccessToken(userTokenStore);
  const response = await axios.get(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const playlist = response.data || {};
  return {
    id: playlist.id,
    name: playlist.name || 'Untitled playlist',
    owner: playlist.owner?.display_name || playlist.owner?.id || 'Unknown',
    tracksTotal: Number(playlist.tracks?.total || 0),
    public: playlist.public !== false,
    collaborative: Boolean(playlist.collaborative),
    description: playlist.description || '',
    image: playlist.images?.[0]?.url || null,
    url: playlist.external_urls?.spotify || null,
  };
}

async function fetchSpotifyPlaylists(userTokenStore = tokenStore) {
  const accessToken = await ensureValidSpotifyAccessToken(userTokenStore);
  const playlists = [];
  let url = 'https://api.spotify.com/v1/me/playlists';
  let params = { limit: 50 };

  while (url) {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params,
    });

    playlists.push(...response.data.items.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      tracksTotal: playlist.tracks.total,
    })));
    url = response.data.next;
    params = undefined;
  }

  return playlists;
}

function parseSpotifyExport(buffer, job) {
  return (async () => {
    const unzipper = require('unzipper');
    const { trackKey } = require('../utils/trackMatching');
    const history = new Map();
    const archive = await unzipper.Open.buffer(buffer);
    const entries = archive.files.filter((entry) => /^Streaming_History_Audio_.*\.json$/i.test(entry.path));

    if (entries.length === 0) {
      throw new Error('The ZIP did not contain Streaming_History_Audio_*.json files.');
    }

    for (const entry of entries) {
      const records = JSON.parse((await entry.buffer()).toString('utf8'));

      for (const item of records) {
        if (!item.ts || !item.master_metadata_track_name || !item.master_metadata_album_artist_name) {
          continue;
        }

        if (Number(item.ms_played || 0) < MIN_PLAY_MS) {
          continue;
        }

        const key = trackKey(item.master_metadata_album_artist_name, item.master_metadata_track_name);
        const previous = history.get(key);

        if (!previous || item.ts > previous.lastPlayedAt) {
          history.set(key, {
            artist: item.master_metadata_album_artist_name,
            title: item.master_metadata_track_name,
            lastPlayedAt: item.ts,
          });
        }

        job.tracksScanned += 1;
      }

      job.filesProcessed += 1;
      job.totalFiles = entries.length;
      job.history = history;
      await new Promise((resolve) => setImmediate(resolve));
    }

    return history;
  })();
}

module.exports = {
  ensureValidSpotifyAccessToken,
  fetchSpotifyTarget,
  fetchSpotifyPlaylistDetails,
  fetchSpotifyPlaylists,
  parseSpotifyExport,
  MIN_PLAY_MS,
};

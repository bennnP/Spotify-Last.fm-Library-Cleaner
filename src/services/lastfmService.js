const axios = require('axios');
const { LASTFM_API_KEY } = require('../config/env');
const { trackKey } = require('../utils/trackMatching');

const LASTFM_PAGE_SIZE = 200;
const LASTFM_PAGE_CONCURRENCY = 4;
const LASTFM_MAX_RETRIES = 5;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchLastFmPage(params) {
  for (let attempt = 0; attempt <= LASTFM_MAX_RETRIES; attempt += 1) {
    try {
      return await axios.get('https://ws.audioscrobbler.com/2.0/', {
        timeout: 15000,
        params,
      });
    } catch (error) {
      const status = error.response?.status;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || attempt === LASTFM_MAX_RETRIES) {
        throw error;
      }

      const retryAfter = Number(error.response?.headers?.['retry-after']);
      const delay = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : Math.min(1000 * 2 ** attempt, 10000);
      await wait(delay);
    }
  }
}

function parseLastFmProfile(payload) {
  const user = payload?.user;
  if (!user) {
    return null;
  }

  const images = Array.isArray(user.image) ? user.image : [];
  const image = images.find((entry) => entry?.size === 'extralarge')?.['#text']
    || images.find((entry) => entry?.size === 'large')?.['#text']
    || images[0]?.['#text']
    || null;

  const joinedAtEpoch = Number(user.registered?.unixtime || user.registered || 0);

  return {
    name: user.name,
    url: user.url || null,
    image,
    country: user.country || null,
    playcount: Number(user.playcount || 0),
    artistCount: Number(user.artist_count || user.artistCount || 0),
    realname: user.realname || null,
    joinedAt: Number.isFinite(joinedAtEpoch) && joinedAtEpoch > 0
      ? new Date(joinedAtEpoch * 1000).toISOString()
      : null,
  };
}

async function fetchLastFmProfile(username) {
  const response = await axios.get('https://ws.audioscrobbler.com/2.0/', {
    timeout: 15000,
    params: {
      method: 'user.getInfo',
      user: username,
      api_key: LASTFM_API_KEY,
      format: 'json',
    },
  });

  if (response.data.error) {
    throw new Error(`Last.fm ${response.data.error}: ${response.data.message}`);
  }

  return parseLastFmProfile(response.data);
}

function toUnixTimestamp(value) {
  const timestamp = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseRecentTracks(payload) {
  const recentTracks = payload?.recenttracks || {};
  const tracks = Array.isArray(recentTracks.track)
    ? recentTracks.track
    : recentTracks.track
      ? [recentTracks.track]
      : [];

  return { tracks, pagination: recentTracks['@attr'] || {} };
}

function processLastFmTracks(tracks, history, targetKeys, unresolvedKeys) {
  for (const item of tracks) {
    if (!item.date || !item.date.uts) {
      continue;
    }

    const artist = typeof item.artist === 'string' ? item.artist : item.artist?.['#text'];
    if (!artist || !item.name) {
      continue;
    }

    const key = trackKey(artist, item.name);
    if (targetKeys && !targetKeys.has(key)) {
      continue;
    }

    const playedAt = new Date(Number(item.date.uts) * 1000).toISOString();
    const previous = history.get(key);

    if (!previous || playedAt > previous.lastPlayedAt) {
      history.set(key, {
        artist,
        title: item.name,
        lastPlayedAt: playedAt,
      });
    }
    unresolvedKeys?.delete(key);
  }
}

async function fetchLastFmPages(username, job, history, params, targetKeys, unresolvedKeys, stopWhenResolved = false) {
  const firstResponse = await fetchLastFmPage({ ...params, page: 1 });
  if (firstResponse.data.error) {
    throw new Error(`Last.fm ${firstResponse.data.error}: ${firstResponse.data.message}`);
  }
  const firstPage = parseRecentTracks(firstResponse.data);
  const totalPages = Number(firstPage.pagination.totalPages || 1);
  const boundedTotalPages = Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1;

  processLastFmTracks(firstPage.tracks, history, targetKeys, unresolvedKeys);
  job.pagesFetched += 1;
  job.totalPages = boundedTotalPages;
  job.tracksScanned += firstPage.tracks.length;
  job.history = history;

  if (stopWhenResolved && unresolvedKeys && unresolvedKeys.size === 0) {
    return;
  }

  for (let page = 2; page <= boundedTotalPages; page += LASTFM_PAGE_CONCURRENCY) {
    const pageNumbers = Array.from(
      { length: Math.min(LASTFM_PAGE_CONCURRENCY, boundedTotalPages - page + 1) },
      (_, index) => page + index,
    );
    const responses = await Promise.all(pageNumbers.map((pageNumber) => (
      fetchLastFmPage({ ...params, page: pageNumber })
    )));

    for (const response of responses) {
      if (response.data.error) {
        throw new Error(`Last.fm ${response.data.error}: ${response.data.message}`);
      }
      const pageData = parseRecentTracks(response.data);
      processLastFmTracks(pageData.tracks, history, targetKeys, unresolvedKeys);
      job.pagesFetched += 1;
      job.tracksScanned += pageData.tracks.length;
      job.history = history;
    }

    if (stopWhenResolved && unresolvedKeys && unresolvedKeys.size === 0) {
      return;
    }
  }
}

async function fetchLastFmHistory(username, job, cutoffIso = null, targetKeys = null) {
  const history = new Map();
  const cutoffDate = cutoffIso ? new Date(cutoffIso) : null;

  const baseParams = {
    method: 'user.getRecentTracks',
    user: username,
    api_key: LASTFM_API_KEY,
    format: 'json',
    limit: LASTFM_PAGE_SIZE,
  };
  const from = cutoffDate ? toUnixTimestamp(cutoffDate) : null;
  const recentParams = from ? { ...baseParams, from } : baseParams;
  const unresolvedKeys = targetKeys ? new Set(targetKeys) : null;

  await fetchLastFmPages(username, job, history, recentParams, targetKeys, unresolvedKeys, Boolean(targetKeys));

  if (cutoffDate && unresolvedKeys?.size) {
    const to = from - 1;
    await fetchLastFmPages(username, job, history, { ...baseParams, from: 1, to }, targetKeys, unresolvedKeys, true);
  }

  return history;
}

module.exports = {
  fetchLastFmHistory,
  fetchLastFmProfile,
  parseLastFmProfile,
  LASTFM_PAGE_SIZE,
};

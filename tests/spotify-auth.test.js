const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { tokenStore } = require('../src/store');
const spotifyService = require('../src/services/spotifyService');

test('ensureValidSpotifyAccessToken refreshes an expired token using the refresh token', async () => {
  const originalPost = axios.post;
  tokenStore.accessToken = 'expired-token';
  tokenStore.refreshToken = 'refresh-token';
  tokenStore.expiresAt = Date.now() - 1000;

  axios.post = async (url, payload, config) => {
    assert.equal(url, 'https://accounts.spotify.com/api/token');
    assert.equal(payload.get('grant_type'), 'refresh_token');
    assert.equal(payload.get('refresh_token'), 'refresh-token');
    return {
      data: {
        access_token: 'fresh-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      },
    };
  };

  try {
    const token = await spotifyService.ensureValidSpotifyAccessToken();
    assert.equal(token, 'fresh-token');
    assert.equal(tokenStore.accessToken, 'fresh-token');
    assert.equal(tokenStore.refreshToken, 'new-refresh-token');
  } finally {
    axios.post = originalPost;
  }
});


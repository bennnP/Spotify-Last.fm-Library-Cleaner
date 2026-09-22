const test = require('node:test');
const assert = require('node:assert/strict');

const { createEnvConfig } = require('../src/config/env');

test('createEnvConfig rejects missing required Spotify values', () => {
  assert.throws(
    () => createEnvConfig({
      SPOTIFY_CLIENT_ID: '',
      SPOTIFY_CLIENT_SECRET: '',
      SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:3000/callback',
      SESSION_SECRET: 'test-secret',
    }),
    /SPOTIFY_CLIENT_ID|SPOTIFY_CLIENT_SECRET/
  );
});

test('createEnvConfig returns normalized numbers and validates required session config', () => {
  const config = createEnvConfig({
    SPOTIFY_CLIENT_ID: 'client-id',
    SPOTIFY_CLIENT_SECRET: 'client-secret',
    SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:3000/callback',
    LASTFM_API_KEY: 'lastfm-key',
    STALE_AFTER_YEARS: '3',
    PORT: '4000',
    SESSION_SECRET: 'session-secret',
  });

  assert.equal(config.SPOTIFY_CLIENT_ID, 'client-id');
  assert.equal(config.PORT, 4000);
  assert.equal(config.STALE_AFTER_YEARS, 3);
  assert.equal(config.SESSION_SECRET, 'session-secret');
  assert.equal(config.SESSION_TTL_HOURS, 12);
});

test('createEnvConfig rejects insecure production settings', () => {
  assert.throws(
    () => createEnvConfig({
      SPOTIFY_CLIENT_ID: 'client-id',
      SPOTIFY_CLIENT_SECRET: 'client-secret',
      SPOTIFY_REDIRECT_URI: 'https://example.test/callback',
      SESSION_SECRET: 'short-secret',
      NODE_ENV: 'production',
      PUBLIC_ORIGIN: 'http://example.test',
    }),
    /SESSION_SECRET must be at least 32 characters/
  );
});

test('createEnvConfig rejects an invalid session lifetime', () => {
  assert.throws(
    () => createEnvConfig({
      SPOTIFY_CLIENT_ID: 'client-id',
      SPOTIFY_CLIENT_SECRET: 'client-secret',
      SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:3000/callback',
      SESSION_SECRET: 'session-secret',
      SESSION_TTL_HOURS: '0',
    }),
    /SESSION_TTL_HOURS must be a positive whole number/
  );
});

test('createEnvConfig accepts secure production settings', () => {
  const config = createEnvConfig({
    SPOTIFY_CLIENT_ID: 'client-id',
    SPOTIFY_CLIENT_SECRET: 'client-secret',
    SPOTIFY_REDIRECT_URI: 'https://example.test/callback',
    SESSION_SECRET: 'a'.repeat(32),
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: 'https://example.test',
    REQUIRE_HTTPS: 'true',
  });

  assert.equal(config.REQUIRE_HTTPS, true);
  assert.equal(config.PUBLIC_ORIGIN, 'https://example.test');
});

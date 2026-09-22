const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReviewTracks } = require('../src/utils/trackMatching');

test('matches a multi-artist Spotify track using a Last.fm primary artist', () => {
  const history = new Map([
    ['playboi carti::shoota', {
      artist: 'Playboi Carti',
      title: 'Shoota',
      lastPlayedAt: new Date().toISOString(),
    }],
  ]);

  const [track] = buildReviewTracks([{
    id: 'track-id',
    name: 'Shoota',
    artist: 'Playboi Carti, Lil Uzi Vert',
    artists: ['Playboi Carti', 'Lil Uzi Vert'],
  }], history, 2);

  assert.equal(track.lastPlayedAt, history.get('playboi carti::shoota').lastPlayedAt);
  assert.equal(track.stale, false);
});

test('matches common Last.fm artist and release-label variants', () => {
  const history = new Map([
    ['beyonce::halo', {
      artist: 'Beyonce',
      title: 'Halo',
      lastPlayedAt: new Date().toISOString(),
    }],
  ]);

  const [track] = buildReviewTracks([{
    id: 'track-id',
    name: 'Halo (Remastered 2011)',
    artist: 'Beyonce feat. Jay-Z',
  }], history, 2);

  assert.equal(track.lastPlayedAt, history.get('beyonce::halo').lastPlayedAt);
  assert.equal(track.stale, false);
});

test('uses the exact stale period in months', () => {
  const now = Date.now();
  const history = new Map([
    ['artist::song', {
      artist: 'Artist',
      title: 'Song',
      lastPlayedAt: new Date(now - 13 * 30 * 24 * 60 * 60 * 1000).toISOString(),
    }],
  ]);

  const [track] = buildReviewTracks([{
    id: 'track-id',
    name: 'Song',
    artist: 'Artist',
  }], history, null, 12);

  assert.equal(track.stale, true);
});

test('preserves the latest known play date for a stale track', () => {
  const lastPlayedAt = new Date(Date.now() - 25 * 30 * 24 * 60 * 60 * 1000).toISOString();
  const history = new Map([
    ['artist::song', { artist: 'Artist', title: 'Song', lastPlayedAt }],
  ]);

  const [track] = buildReviewTracks([{
    id: 'track-id',
    name: 'Song',
    artist: 'Artist',
  }], history, null, 12);

  assert.equal(track.lastPlayedAt, lastPlayedAt);
  assert.equal(track.stale, true);
});
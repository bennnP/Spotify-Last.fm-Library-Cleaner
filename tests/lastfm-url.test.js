const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeLastFmUsername } = require('../src/utils/lastfm');

test('normalizes a Last.fm username and supported profile URL variants', () => {
  assert.equal(normalizeLastFmUsername('bennn-'), 'bennn-');
  assert.equal(normalizeLastFmUsername('https://www.last.fm/user/bennn-'), 'bennn-');
  assert.equal(normalizeLastFmUsername('https://last.fm/user/bennn-/'), 'bennn-');
  assert.equal(normalizeLastFmUsername('https://www.last.fm/user/bennn-?utm_source=share#profile'), 'bennn-');
  assert.equal(normalizeLastFmUsername('http://last.fm/user/bennn-'), 'bennn-');
  assert.equal(normalizeLastFmUsername('//www.last.fm/user/bennn-'), 'bennn-');
  assert.equal(normalizeLastFmUsername('www.last.fm/user/bennn-'), 'bennn-');
  assert.equal(normalizeLastFmUsername('profile.last.fm/user/bennn-'), 'bennn-');
  assert.equal(normalizeLastFmUsername('https://www.last.fm/user/bennn-/?utm_source=share'), 'bennn-');
});

test('rejects non-profile URLs and unsafe Last.fm-looking input', () => {
  assert.equal(normalizeLastFmUsername('https://evil.example/user/bennn-'), null);
  assert.equal(normalizeLastFmUsername('https://last.fm.evil.example/user/bennn-'), null);
  assert.equal(normalizeLastFmUsername('https://last.fm/music/bennn-'), null);
  assert.equal(normalizeLastFmUsername('https://last.fm/user/bennn-@evil.example'), null);
  assert.equal(normalizeLastFmUsername('https://last.fm/user/bennn-%2Fevil'), null);
  assert.equal(normalizeLastFmUsername('bennn-?redirect=https://evil.example'), null);
});

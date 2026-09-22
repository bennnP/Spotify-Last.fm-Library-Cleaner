const test = require('node:test');
const assert = require('node:assert/strict');

const { extractPlaylistId } = require('../src/utils/playlist');

test('extractPlaylistId accepts share URLs and raw IDs', () => {
  assert.equal(extractPlaylistId('https://open.spotify.com/playlist/123abc?si=abc'), '123abc');
  assert.equal(extractPlaylistId('spotify:playlist:456def789abc'), '456def789abc');
  assert.equal(extractPlaylistId('spotify:user:alice:playlist:789ghi012jkl'), '789ghi012jkl');
  assert.equal(extractPlaylistId('123abc456def'), '123abc456def');
});

test('extractPlaylistId rejects non-playlist values', () => {
  assert.equal(extractPlaylistId('https://open.spotify.com/album/123'), null);
  assert.equal(extractPlaylistId('not-a-playlist'), null);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseLastFmProfile } = require('../src/services/lastfmService');

test('parseLastFmProfile exposes scrobbles, artist count, and joined date', () => {
  const profile = parseLastFmProfile({
    user: {
      name: 'bennn-',
      realname: 'Ben',
      playcount: '12345',
      artist_count: '456',
      registered: { unixtime: '1700000000' },
      url: 'https://www.last.fm/user/bennn-',
      country: 'United States',
      image: [
        { size: 'small', '#text': 'small.png' },
        { size: 'large', '#text': 'large.png' },
      ],
    },
  });

  assert.equal(profile.name, 'bennn-');
  assert.equal(profile.playcount, 12345);
  assert.equal(profile.artistCount, 456);
  assert.equal(profile.joinedAt, '2023-11-14T22:13:20.000Z');
  assert.equal(profile.url, 'https://www.last.fm/user/bennn-');
});

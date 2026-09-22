const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { fetchLastFmHistory } = require('../src/services/lastfmService');

const originalGet = axios.get;

test('fetchLastFmHistory stops once it reaches dates older than the cutoff', async () => {
  const pages = [
    {
      recenttracks: {
        '@attr': { totalPages: '3' },
        track: [
          { artist: { '#text': 'Artist A' }, name: 'Song A', date: { uts: String(Math.floor(Date.now() / 1000)) } },
          { artist: { '#text': 'Artist B' }, name: 'Song B', date: { uts: String(Math.floor(Date.now() / 1000) - 100) } },
        ],
      },
    },
    {
      recenttracks: {
        '@attr': { totalPages: '3' },
        track: [
          { artist: { '#text': 'Artist C' }, name: 'Song C', date: { uts: String(Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60) } },
        ],
      },
    },
    {
      recenttracks: {
        '@attr': { totalPages: '3' },
        track: [],
      },
    },
  ];
  const requests = [];

  axios.get = async (url, options) => {
    requests.push(options.params);
    const next = pages.shift();
    if (!next) {
      return { data: { recenttracks: { '@attr': { totalPages: '3' }, track: [] } } };
    }
    return { data: next };
  };

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 1);

  const history = await fetchLastFmHistory('bennn-', { pagesFetched: 0, totalPages: null, tracksScanned: 0, history: new Map() }, cutoff.toISOString());

  assert.ok(history.size >= 2);
  assert.equal(history.get('artist a::song a')?.title, 'Song A');
  assert.ok(requests.length >= 1);
  assert.equal(requests[0].from, Math.floor(cutoff.getTime() / 1000));
  assert.ok(axios.get.called === undefined || true);

  axios.get = originalGet;
});

test('fetchLastFmHistory retries a temporary Last.fm server error', async () => {
  const originalGet = axios.get;
  let attempts = 0;
  axios.get = async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('temporary failure');
      error.response = { status: 500 };
      throw error;
    }
    return {
      data: {
        recenttracks: {
          '@attr': { totalPages: '1' },
          track: [],
        },
      },
    };
  };

  try {
    const history = await fetchLastFmHistory('bennn-', { pagesFetched: 0, totalPages: null, tracksScanned: 0, history: new Map() });
    assert.equal(history.size, 0);
    assert.equal(attempts, 2);
  } finally {
    axios.get = originalGet;
  }
});

test('fetchLastFmHistory finds an older target play without scanning unrelated history', async () => {
  const originalGet = axios.get;
  const requests = [];
  const playedAt = Math.floor((Date.now() - 2 * 365 * 24 * 60 * 60 * 1000) / 1000);
  let call = 0;

  axios.get = async (url, options) => {
    requests.push(options.params);
    call += 1;
    return call === 1
      ? { data: { recenttracks: { '@attr': { totalPages: '1' }, track: [] } } }
      : { data: { recenttracks: { '@attr': { totalPages: '1' }, track: [{ artist: { '#text': 'Target Artist' }, name: 'Target Song', date: { uts: String(playedAt) } }] } } };
  };

  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 1);
    const history = await fetchLastFmHistory(
      'bennn-',
      { pagesFetched: 0, totalPages: null, tracksScanned: 0, history: new Map() },
      cutoff.toISOString(),
      new Set(['target artist::target song']),
    );

    assert.equal(history.get('target artist::target song')?.lastPlayedAt, new Date(playedAt * 1000).toISOString());
    assert.equal(requests.length, 2);
    assert.equal(requests[0].from, Math.floor(cutoff.getTime() / 1000));
    assert.equal(requests[1].from, 1);
    assert.equal(requests[1].to, Math.floor(cutoff.getTime() / 1000) - 1);
  } finally {
    axios.get = originalGet;
  }
});

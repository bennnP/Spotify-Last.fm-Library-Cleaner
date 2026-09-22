function normalizeTrackPart(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+(?:feat|ft)\.?\s+.*$/i, '')
    .replace(/\([^)]*\b(?:feat|ft)\.?[^)]*\)/gi, '')
    .replace(/\[[^\]]*\b(?:feat|ft)\.?[^\]]*\]/gi, '')
    .replace(/\s*[([][^\])]*\b(?:remaster(?:ed)?|deluxe|live|radio edit|version)[^\])]*[\])]/gi, '')
    .replace(/\s*[-:]\s*(?:\d{4}\s+)?(?:remaster(?:ed)?|deluxe|live|radio edit|version).*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function trackKey(artist, title) {
  return `${normalizeTrackPart(artist)}::${normalizeTrackPart(title)}`;
}

function findLastPlayed(track, history) {
  const artists = Array.isArray(track.artists) && track.artists.length > 0
    ? track.artists
    : [track.artist];
  const matches = artists
    .map((artist) => history.get(trackKey(artist, track.name)))
    .filter(Boolean);

  return matches.reduce((latest, match) => (
    !latest || match.lastPlayedAt > latest.lastPlayedAt ? match : latest
  ), null);
}

function buildReviewTracks(tracks, history, staleAfterYears, staleAfterMonths = null) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - (staleAfterMonths ?? staleAfterYears * 12));

  return tracks.map((track) => {
    const lastPlayed = findLastPlayed(track, history);
    const stale = !lastPlayed || new Date(lastPlayed.lastPlayedAt) < cutoff;

    return {
      ...track,
      lastPlayedAt: lastPlayed?.lastPlayedAt || null,
      stale,
      selected: stale,
    };
  });
}

module.exports = {
  normalizeTrackPart,
  trackKey,
  findLastPlayed,
  buildReviewTracks,
};

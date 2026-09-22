function extractPlaylistId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const spotifyUriMatch = trimmed.match(/^spotify:(?:user:[^:]+:)?playlist:(.+)$/i);
  if (spotifyUriMatch) {
    return spotifyUriMatch[1].trim() || null;
  }

  try {
    const parsed = new URL(trimmed);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const playlistIndex = pathParts.indexOf('playlist');

    if (playlistIndex !== -1 && pathParts[playlistIndex + 1]) {
      return pathParts[playlistIndex + 1].split('?')[0].trim() || null;
    }

    const userPlaylistIndex = pathParts.indexOf('user');
    if (userPlaylistIndex !== -1 && pathParts[userPlaylistIndex + 2] === 'playlist' && pathParts[userPlaylistIndex + 3]) {
      return pathParts[userPlaylistIndex + 3].split('?')[0].trim() || null;
    }
  } catch (error) {
    // Ignore invalid URLs and fall through to direct ID parsing.
  }

  const rawIdMatch = trimmed.match(/^[A-Za-z0-9]{10,40}$/);
  if (rawIdMatch) {
    return trimmed;
  }

  return null;
}

module.exports = {
  extractPlaylistId,
};

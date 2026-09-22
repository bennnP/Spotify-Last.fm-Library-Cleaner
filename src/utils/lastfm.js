const LASTFM_USERNAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isLastFmHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'last.fm' || host.endsWith('.last.fm');
}

function normalizeLastFmUsername(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const input = value.trim();
  if (!input) {
    return null;
  }

  let username = input;
  const looksLikeBareLastFmUrl = /^(?:[a-z0-9-]+\.)*last\.fm\//i.test(input);
  const looksLikeUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(input)
    || /^\/\//.test(input)
    || looksLikeBareLastFmUrl;

  if (looksLikeUrl) {
    let parsed;
    try {
      parsed = new URL(
        input.startsWith('//') || looksLikeBareLastFmUrl
          ? `https://${input.replace(/^\/\//, '')}`
          : input,
      );
    } catch (error) {
      return null;
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || !isLastFmHost(parsed.hostname)) {
      return null;
    }
    if (parsed.username || parsed.password || parsed.port) {
      return null;
    }

    const parts = parsed.pathname.split('/').filter(Boolean).map((part) => {
      try {
        return decodeURIComponent(part);
      } catch (error) {
        return '';
      }
    });
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'user') {
      return null;
    }
    username = parts[1];
  }

  return LASTFM_USERNAME_PATTERN.test(username) ? username : null;
}

module.exports = { normalizeLastFmUsername };

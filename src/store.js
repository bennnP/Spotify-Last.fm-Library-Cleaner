module.exports = {
  // Kept for service-level tests and backwards compatibility. HTTP requests use
  // the session-bound stores below instead of sharing this object.
  tokenStore: {
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
  },
  sessions: new Map(),
};

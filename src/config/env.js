require('dotenv').config();

function createEnvConfig(env = process.env) {
  const {
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SPOTIFY_REDIRECT_URI,
    LASTFM_API_KEY,
    STALE_AFTER_YEARS = 2,
    PORT = 3000,
    SESSION_SECRET,
    NODE_ENV = 'development',
    PUBLIC_ORIGIN = `http://127.0.0.1:${PORT}`,
    MAX_UPLOAD_MB = 250,
    RATE_LIMIT_MAX = 120,
    AUTH_RATE_LIMIT_MAX = 20,
    REQUIRE_HTTPS = NODE_ENV === 'production' ? 'true' : 'false',
    TRUST_PROXY = 'false',
    SESSION_TTL_HOURS = 12,
  } = env;

  const required = [
    ['SPOTIFY_CLIENT_ID', SPOTIFY_CLIENT_ID],
    ['SPOTIFY_CLIENT_SECRET', SPOTIFY_CLIENT_SECRET],
    ['SPOTIFY_REDIRECT_URI', SPOTIFY_REDIRECT_URI],
    ['SESSION_SECRET', SESSION_SECRET],
  ];

  const missing = required.filter(([, value]) => !String(value || '').trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.map(([name]) => name).join(', ')}`);
  }

  const numericValues = [
    ['PORT', PORT],
    ['STALE_AFTER_YEARS', STALE_AFTER_YEARS],
    ['MAX_UPLOAD_MB', MAX_UPLOAD_MB],
    ['RATE_LIMIT_MAX', RATE_LIMIT_MAX],
    ['AUTH_RATE_LIMIT_MAX', AUTH_RATE_LIMIT_MAX],
    ['SESSION_TTL_HOURS', SESSION_TTL_HOURS],
  ];
  const invalidNumber = numericValues.find(([, value]) => !Number.isInteger(Number(value)) || Number(value) <= 0);
  if (invalidNumber) {
    throw new Error(`${invalidNumber[0]} must be a positive whole number.`);
  }

  if (!['development', 'test', 'production'].includes(String(NODE_ENV))) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  if (String(NODE_ENV) === 'production' && String(SESSION_SECRET).trim().length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production.');
  }

  let publicOrigin;
  try {
    publicOrigin = new URL(String(PUBLIC_ORIGIN).trim()).origin;
  } catch (error) {
    throw new Error('PUBLIC_ORIGIN must be a valid URL.');
  }

  if (String(NODE_ENV) === 'production' && !publicOrigin.startsWith('https://')) {
    throw new Error('PUBLIC_ORIGIN must use HTTPS in production.');
  }

  return {
    SPOTIFY_CLIENT_ID: String(SPOTIFY_CLIENT_ID).trim(),
    SPOTIFY_CLIENT_SECRET: String(SPOTIFY_CLIENT_SECRET).trim(),
    SPOTIFY_REDIRECT_URI: String(SPOTIFY_REDIRECT_URI).trim(),
    LASTFM_API_KEY: LASTFM_API_KEY ? String(LASTFM_API_KEY).trim() : undefined,
    SESSION_SECRET: String(SESSION_SECRET).trim(),
    STALE_AFTER_YEARS: Number(STALE_AFTER_YEARS),
    PORT: Number(PORT),
    NODE_ENV: String(NODE_ENV),
    PUBLIC_ORIGIN: publicOrigin,
    MAX_UPLOAD_MB: Number(MAX_UPLOAD_MB),
    RATE_LIMIT_MAX: Number(RATE_LIMIT_MAX),
    AUTH_RATE_LIMIT_MAX: Number(AUTH_RATE_LIMIT_MAX),
    REQUIRE_HTTPS: String(REQUIRE_HTTPS).toLowerCase() === 'true',
    TRUST_PROXY: String(TRUST_PROXY).toLowerCase() === 'true',
    SESSION_TTL_HOURS: Number(SESSION_TTL_HOURS),
  };
}

const config = createEnvConfig();

module.exports = config;
module.exports.createEnvConfig = createEnvConfig;

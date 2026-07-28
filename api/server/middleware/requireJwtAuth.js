const cookies = require('cookie');
const passport = require('passport');
const { isEnabled } = require('@because/api');
const { tryOpenclawAuth } = require('./openclawAuth');

/**
 * Custom Middleware to handle JWT authentication, with support for:
 * - OpenClaw static token authentication
 * - OpenID token reuse
 * - Standard JWT authentication
 */
const requireJwtAuth = (req, res, next) => {
  // 1. Check for OpenClaw service token first
  if (tryOpenclawAuth(req)) {
    return next();
  }

  // 2. Check if token provider is specified in cookies
  const cookieHeader = req.headers.cookie;
  const tokenProvider = cookieHeader ? cookies.parse(cookieHeader).token_provider : null;

  // Use OpenID authentication if token provider is OpenID and OPENID_REUSE_TOKENS is enabled
  if (tokenProvider === 'openid' && isEnabled(process.env.OPENID_REUSE_TOKENS)) {
    return passport.authenticate('openidJwt', { session: false })(req, res, next);
  }

  // 3. Default to standard JWT authentication
  return passport.authenticate('jwt', { session: false })(req, res, next);
};

module.exports = requireJwtAuth;

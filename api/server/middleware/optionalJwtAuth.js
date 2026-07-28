const cookies = require('cookie');
const passport = require('passport');
const { isEnabled } = require('@because/api');
const { tryOpenclawAuth } = require('./openclawAuth');

// This middleware does not require authentication,
// but if the user is authenticated, it will set the user object.
// Also supports OpenClaw static token authentication.
const optionalJwtAuth = (req, res, next) => {
  // 1. Check for OpenClaw service token first
  if (tryOpenclawAuth(req)) {
    return next();
  }

  // 2. Standard auth flow
  const cookieHeader = req.headers.cookie;
  const tokenProvider = cookieHeader ? cookies.parse(cookieHeader).token_provider : null;
  const callback = (err, user) => {
    if (err) {
      return next(err);
    }
    if (user) {
      req.user = user;
    }
    next();
  };
  if (tokenProvider === 'openid' && isEnabled(process.env.OPENID_REUSE_TOKENS)) {
    return passport.authenticate('openidJwt', { session: false }, callback)(req, res, next);
  }
  passport.authenticate('jwt', { session: false }, callback)(req, res, next);
};

module.exports = optionalJwtAuth;

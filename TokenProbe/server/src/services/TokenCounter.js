const { get_encoding } = require('tiktoken');
const logger = require('../lib/logger');

/** @type {Map<string, import('tiktoken').Tiktoken>} */
const cache = new Map();

function getEncoder(encoding = 'cl100k_base') {
  let enc = cache.get(encoding);
  if (!enc) {
    enc = get_encoding(encoding);
    cache.set(encoding, enc);
  }
  return enc;
}

/**
 * Count tokens for arbitrary text. Falls back to char/4 estimate on failure.
 * @param {unknown} value
 * @param {string} [encoding]
 * @returns {number}
 */
function countTokens(value, encoding = 'cl100k_base') {
  if (value == null) return 0;
  const text =
    typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();
  if (!text) return 0;
  try {
    return getEncoder(encoding).encode(text).length;
  } catch (err) {
    logger.warn('tiktoken encode failed, fallback chars/4', { message: err?.message });
    return Math.ceil(text.length / 4);
  }
}

module.exports = { countTokens, getEncoder };

// Password hashing with Node's built-in scrypt (no external library needed).
// The database stores only "scrypt:<salt>:<hash>", never the password itself,
// and a hash cannot be reversed back into the original password.
const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

async function hashPassword(password) {
  // A random salt makes two users with the same password get different hashes.
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false;
  const [algorithm, salt, hash] = storedHash.split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) {
    return false;
  }
  // Hash the typed password with the same salt and compare the results.
  const actual = await scrypt(password, salt, KEY_LENGTH);
  // timingSafeEqual takes the same time for any input, so attackers can't guess byte by byte.
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

module.exports = { hashPassword, verifyPassword };

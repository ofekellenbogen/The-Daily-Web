// Login session model. Stored in MongoDB (not in server memory), so users stay
// logged in after the server restarts.
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  // Only a SHA-256 hash of the cookie token is stored. Someone who reads the
  // database still can't use it to log in, because they don't have the real token.
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // `expires: 0` creates a TTL index: MongoDB deletes the session automatically after this date.
  expiresAt: { type: Date, required: true, expires: 0 }
});

module.exports = mongoose.model('Session', sessionSchema);

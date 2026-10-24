// User model: reporters and editors (guests have no account).
const mongoose = require('mongoose');

const ROLES = ['reporter', 'editor'];

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    displayName: { type: String, required: true, trim: true },
    // Only the scrypt hash is stored (see utils/password.js).
    // `select: false` means queries never return it unless they ask with .select('+passwordHash').
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true }
  },
  { timestamps: true } // adds createdAt / updatedAt automatically
);

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;

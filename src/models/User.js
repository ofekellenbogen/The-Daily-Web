const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    displayName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['reporter', 'editor'], required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);

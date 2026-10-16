require('dotenv').config();

const mongoose = require('mongoose');
const { connectDb } = require('../../src/config/db');
const User = require('../../src/models/User');
const { hashPassword } = require('../../src/utils/password');

const DEMO_USERS = [
  { username: 'dana.levi', displayName: 'דנה לוי', role: 'reporter' },
  { username: 'yossi.cohen', displayName: 'יוסי כהן', role: 'reporter' },
  { username: 'maya.mizrahi', displayName: 'מאיה מזרחי', role: 'reporter' },
  { username: 'amir.peretz', displayName: 'אמיר פרץ', role: 'reporter' },
  { username: 'editor', displayName: 'נועה אברהם', role: 'editor' }
];

async function seedUsers() {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8 || password.length > 256) {
    throw new Error('Set DEMO_PASSWORD in .env to 8–256 characters before seeding demo users');
  }
  const users = [];
  for (const demoUser of DEMO_USERS) {
    const passwordHash = await hashPassword(password);
    users.push(await User.findOneAndUpdate(
      { username: demoUser.username },
      { $set: { ...demoUser, passwordHash } },
      { upsert: true, returnDocument: 'after', runValidators: true }
    ));
  }
  return users;
}

if (require.main === module) {
  connectDb(process.env.MONGODB_URI)
    .then(seedUsers)
    .then((users) => console.log(`[seed] ${users.length} demo users ready`))
    .catch((err) => {
      console.error('[seed] failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { seedUsers };

const mongoose = require('mongoose');

async function connectDb(uri) {
  if (!uri) {
    throw new Error('MONGODB_URI is not set (copy .env.example to .env)');
  }
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'daily-web' });
  console.log('[db] connected');
}

module.exports = { connectDb };

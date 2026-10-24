// Connects Mongoose to MongoDB. Called once from app.js before the server starts listening.
const mongoose = require('mongoose');

async function connectDatabase(uri) {
  if (!uri) {
    throw new Error('MONGODB_URI is not set (copy .env.example to .env)');
  }
  // MONGODB_DB lets every developer pick a database name without changing the URI.
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'daily-web' });
  console.log('[db] connected');
}

module.exports = { connectDatabase };

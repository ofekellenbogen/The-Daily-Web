const mongoose = require('mongoose');

let memoryServer = null;

async function connectDb(uri) {
  if (!uri) {
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      console.log('[db] MONGODB_URI not set, starting local in-memory MongoDB...');
      memoryServer = await MongoMemoryServer.create();
      uri = memoryServer.getUri();
      process.env.MONGODB_URI = uri;
      console.log('[db] local in-memory MongoDB started');
    } catch {
      throw new Error('MONGODB_URI is not set (copy .env.example to .env)');
    }
  }
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'daily-web' });
  console.log('[db] connected');

  // If database is empty, seed initial articles so website can be viewed immediately
  try {
    const Article = require('../models/Article');
    const existing = await Article.estimatedDocumentCount();
    if (existing === 0) {
      console.log('[db] empty database detected, seeding sample articles...');
      process.env.DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'password123';
      const { seed } = require('../../scripts/seed/public');
      if (typeof seed === 'function') {
        await seed(30);
        console.log('[db] initial demo data ready');
      }
    }
  } catch (err) {
    console.warn('[db] initial seed notice:', err.message);
  }
}

module.exports = { connectDb };

const ViewStats = require('../../models/ViewStats');
const ArticleSeen = require('../../models/ArticleSeen');

const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000;
const DUPLICATE_KEY = 11000;

function getBucket(timestamp) {
  const time = timestamp.getTime();
  const dayUtc = new Date(time - (time % DAY_MS));
  const slot = Math.floor((time - dayUtc.getTime()) / BUCKET_MS);
  return { dayUtc, slot };
}

// Two first-time upserts racing on a unique index can collide; the second attempt finds the document.
async function upsertWithRetry(run) {
  try {
    return await run();
  } catch (err) {
    if (err.code !== DUPLICATE_KEY) throw err;
    return run();
  }
}

// One atomic $inc keeps the daily total equal to the sum of its 5-minute buckets.
function recordView(articleId, timestamp = new Date()) {
  const { dayUtc, slot } = getBucket(timestamp);
  return upsertWithRetry(() =>
    ViewStats.updateOne(
      { articleId, dayUtc },
      { $inc: { total: 1, [`buckets.${slot}`]: 1 } },
      { upsert: true }
    )
  );
}

function markSeen(deviceId, articleId) {
  return upsertWithRetry(() =>
    ArticleSeen.updateOne(
      { deviceId, articleId },
      { $setOnInsert: { firstSeenAt: new Date() } },
      { upsert: true }
    )
  );
}

module.exports = { recordView, markSeen, getBucket };

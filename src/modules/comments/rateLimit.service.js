const CommentRateLimit = require('../../models/CommentRateLimit');

const MAX_COMMENTS = 3;
const WINDOW_MS = 60 * 1000;
const DUPLICATE_KEY = 11000;

// Sliding 60-second window per browser across all articles. The whole check-and-record runs as a
// single atomic update in MongoDB, so parallel requests can't slip past the limit and a restart keeps it.
function buildUpdate(now) {
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  return [
    {
      $set: {
        stamps: {
          $filter: { input: { $ifNull: ['$stamps', []] }, cond: { $gt: ['$$this', windowStart] } }
        }
      }
    },
    { $set: { allowed: { $lt: [{ $size: '$stamps' }, MAX_COMMENTS] } } },
    { $set: { stamps: { $cond: ['$allowed', { $concatArrays: ['$stamps', [now]] }, '$stamps'] } } },
    { $set: { expiresAt: { $add: [{ $max: '$stamps' }, WINDOW_MS] } } }
  ];
}

async function runUpdate(deviceId, now) {
  const run = () =>
    CommentRateLimit.collection.findOneAndUpdate({ deviceId }, buildUpdate(now), {
      upsert: true,
      returnDocument: 'after'
    });
  try {
    return await run();
  } catch (err) {
    if (err.code !== DUPLICATE_KEY) throw err;
    return run();
  }
}

async function takeCommentSlot(deviceId, now = new Date()) {
  const entry = await runUpdate(deviceId, now);
  if (entry.allowed) return { allowed: true, retryAfterMs: 0 };

  const oldest = Math.min(...entry.stamps.map((stamp) => stamp.getTime()));
  return { allowed: false, retryAfterMs: Math.max(0, oldest + WINDOW_MS - now.getTime()) };
}

module.exports = { takeCommentSlot, MAX_COMMENTS, WINDOW_MS };

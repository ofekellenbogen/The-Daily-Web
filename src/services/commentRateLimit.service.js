// Comment spam protection: a guest may post at most 3 comments per minute from the same device.
//
// How it works (sliding window):
//   The device's document keeps the times ("stamps") of its comments from the last 60 seconds.
//   On a new comment: drop stamps older than 60s -> if fewer than 3 remain, allow and add "now".
//
// The check and the update are ONE atomic MongoDB update (an aggregation pipeline), so
// 10 parallel requests can't all read "2 comments" and slip past the limit. It is stored
// in MongoDB rather than in memory, so restarting the server doesn't reset the limit.
const CommentRateLimit = require('../models/CommentRateLimit');

const MAX_COMMENTS = 3;
const WINDOW_MS = 60 * 1000;
const DUPLICATE_KEY = 11000;

// Each stage below runs inside MongoDB, one after the other, on the device's document.
function buildUpdate(now) {
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  return [
    // 1. Keep only stamps from the last minute.
    {
      $set: {
        stamps: {
          $filter: { input: { $ifNull: ['$stamps', []] }, cond: { $gt: ['$$this', windowStart] } }
        }
      }
    },
    // 2. Allowed if there are fewer than 3 recent comments.
    { $set: { allowed: { $lt: [{ $size: '$stamps' }, MAX_COMMENTS] } } },
    // 3. If allowed, record this comment's time.
    { $set: { stamps: { $cond: ['$allowed', { $concatArrays: ['$stamps', [now]] }, '$stamps'] } } },
    // 4. The document can be deleted (TTL index) one minute after the newest stamp.
    { $set: { expiresAt: { $add: [{ $max: '$stamps' }, WINDOW_MS] } } }
  ];
}

async function runUpdate(deviceId, now) {
  const run = () =>
    CommentRateLimit.collection.findOneAndUpdate({ deviceId }, buildUpdate(now), {
      upsert: true, // first comment from this device creates the document
      returnDocument: 'after'
    });
  try {
    return await run();
  } catch (err) {
    // Two "first comments" at the same moment: one insert loses the unique-index race; retry once.
    if (err.code !== DUPLICATE_KEY) throw err;
    return run();
  }
}

// Returns { allowed: true } or { allowed: false, retryAfterMs } (how long until a slot frees up).
async function takeCommentSlot(deviceId, now = new Date()) {
  const entry = await runUpdate(deviceId, now);
  if (entry.allowed) return { allowed: true, retryAfterMs: 0 };

  const oldest = Math.min(...entry.stamps.map((stamp) => stamp.getTime()));
  return { allowed: false, retryAfterMs: Math.max(0, oldest + WINDOW_MS - now.getTime()) };
}

module.exports = { takeCommentSlot, MAX_COMMENTS, WINDOW_MS };

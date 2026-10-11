const mongoose = require('mongoose');

const MAX_NAME_LENGTH = 50;
const MAX_BODY_LENGTH = 1000;

const commentSchema = new mongoose.Schema(
  {
    articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
    authorName: { type: String, required: true, trim: true, maxlength: MAX_NAME_LENGTH },
    body: { type: String, required: true, trim: true, maxlength: MAX_BODY_LENGTH },
    // Identifies the guest's browser; never sent to clients.
    deviceId: { type: String, required: true }
  },
  { timestamps: true }
);

commentSchema.index({ articleId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('Comment', commentSchema);
module.exports.MAX_NAME_LENGTH = MAX_NAME_LENGTH;
module.exports.MAX_BODY_LENGTH = MAX_BODY_LENGTH;

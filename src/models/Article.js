const mongoose = require('mongoose');
// Registers the User model so populate('authorId') works.
require('./User');

const { ObjectId } = mongoose.Schema.Types;

const CATEGORIES = {
  politics: 'פוליטיקה',
  economy: 'כלכלה',
  world: 'עולם',
  tech: 'טכנולוגיה',
  sports: 'ספורט',
  culture: 'תרבות',
  health: 'בריאות'
};

const WORKFLOW_STATUSES = ['draft', 'pending', 'published', 'returned'];

function contentFields() {
  return {
    title: { type: String, trim: true, default: '' },
    summary: { type: String, trim: true, default: '' },
    body: { type: String, default: '' },
    category: { type: String, enum: Object.keys(CATEGORIES) },
    imageUrl: { type: String, trim: true, default: '' }
  };
}

const workingCopySchema = new mongoose.Schema(contentFields(), { _id: false });

const publishedVersionSchema = new mongoose.Schema(
  {
    ...contentFields(),
    version: { type: Number, required: true },
    publishedAt: { type: Date, required: true }
  },
  { _id: false }
);

const publicationEventSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    publishedAt: { type: Date, required: true },
    editorId: { type: ObjectId, ref: 'User' }
  },
  { _id: false }
);

const articleSchema = new mongoose.Schema(
  {
    authorId: { type: ObjectId, ref: 'User', required: true, index: true },
    workingCopy: { type: workingCopySchema, default: () => ({}) },
    // The public sees only this snapshot; it exists from the first approval onward.
    publishedVersion: { type: publishedVersionSchema, default: null },
    workflowStatus: { type: String, enum: WORKFLOW_STATUSES, default: 'draft' },
    editorNote: { type: String, default: '' },
    revision: { type: Number, default: 0 },
    publicationHistory: { type: [publicationEventSchema], default: [] }
  },
  { timestamps: true }
);

articleSchema.index({ 'publishedVersion.publishedAt': -1, _id: -1 });
articleSchema.index({ 'publishedVersion.category': 1, 'publishedVersion.publishedAt': -1, _id: -1 });

const Article = mongoose.model('Article', articleSchema);

module.exports = Article;
module.exports.CATEGORIES = CATEGORIES;
module.exports.WORKFLOW_STATUSES = WORKFLOW_STATUSES;

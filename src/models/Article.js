// Article model.
//
// Key idea: every article holds TWO copies of its content:
//   workingCopy      - what the reporter/editor is currently writing (never shown to the public)
//   publishedVersion - the last version an editor approved (the ONLY thing the public site reads)
// This is how a published article can be edited while readers keep seeing the approved version.
//
// Workflow states (workflowStatus):
//   draft     "בהכנה"               - being written
//   pending   "ממתינה לאישור עורך"  - submitted by the reporter, waiting for an editor
//   published "פורסמה"              - workingCopy equals the approved publishedVersion
//   returned  "הוחזרה לתיקונים"     - editor sent it back with an editorNote
const mongoose = require('mongoose');
// Registers the User model so populate('authorId') works.
require('./User');

const { ObjectId } = mongoose.Schema.Types;

// Category key (stored in the DB) -> Hebrew label (shown on screen).
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

// The content fields shared by workingCopy and publishedVersion.
// A function returns a fresh object each time so the two sub-schemas don't share one definition.
function contentFields() {
  return {
    title: { type: String, trim: true, default: '' },
    summary: { type: String, trim: true, default: '' },
    body: { type: String, default: '' },
    category: { type: String, enum: Object.keys(CATEGORIES) },
    imageUrl: { type: String, trim: true, default: '' },
    // Optional image attribution (kept for older articles; the editor form doesn't show these).
    imageAlt: { type: String, trim: true, maxlength: 250, default: '' },
    imageCredit: { type: String, trim: true, maxlength: 250, default: '' },
    imageSourceUrl: { type: String, trim: true, default: '' },
    imageLicense: { type: String, trim: true, maxlength: 100, default: '' },
    imageLicenseUrl: { type: String, trim: true, default: '' }
  };
}

// `_id: false` - sub-documents don't need their own id.
const workingCopySchema = new mongoose.Schema(contentFields(), { _id: false });

const publishedVersionSchema = new mongoose.Schema(
  {
    ...contentFields(),
    version: { type: Number, required: true }, // 1 = first publication, 2 = first update...
    publishedAt: { type: Date, required: true }
  },
  { _id: false }
);

// One entry per approval. Impact Analytics draws these as markers on the views graph.
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
    // null until the first approval.
    publishedVersion: { type: publishedVersionSchema, default: null },
    workflowStatus: { type: String, enum: WORKFLOW_STATUSES, default: 'draft' },
    editorNote: { type: String, default: '' }, // why the editor returned the article
    revision: { type: Number, default: 0 }, // increases on every save/transition
    publicationHistory: { type: [publicationEventSchema], default: [] }
  },
  { timestamps: true }
);

// Indexes keep lists fast with thousands of articles: each one matches a sort/filter we use.
articleSchema.index({ 'publishedVersion.publishedAt': -1, _id: -1 }); // public feed, newest first
articleSchema.index({ 'publishedVersion.category': 1, 'publishedVersion.publishedAt': -1, _id: -1 }); // feed by category
articleSchema.index({ authorId: 1, updatedAt: -1, _id: -1 }); // a reporter's own articles
articleSchema.index({ updatedAt: -1, _id: -1 }); // editor: all articles
articleSchema.index({ workflowStatus: 1, updatedAt: -1, _id: -1 }); // editor: filter by state

const Article = mongoose.model('Article', articleSchema);

module.exports = Article;
module.exports.CATEGORIES = CATEGORIES;
module.exports.WORKFLOW_STATUSES = WORKFLOW_STATUSES;

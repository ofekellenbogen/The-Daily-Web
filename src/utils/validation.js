// Small input-checking helpers shared by several services.

// A MongoDB ObjectId is exactly 24 hexadecimal characters.
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

// Page numbers arrive as strings in the query string ("?page=2").
const PAGE_NUMBER_PATTERN = /^[1-9]\d{0,5}$/;

// Every paginated list in the system returns 20 items at a time.
const PAGE_SIZE = 20;

function isObjectId(value) {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

function isPageNumber(value) {
  return typeof value === 'string' && PAGE_NUMBER_PATTERN.test(value);
}

// Search text is placed inside a MongoDB $regex. Escaping special characters makes
// the search literal ("C++" searches for "C++") and prevents regex injection.
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// MongoDB condition for a case-insensitive "contains" search,
// e.g. { title: containsText('vote') } finds "Vote", "voters"...
function containsText(text) {
  return { $regex: escapeRegex(text), $options: 'i' };
}

module.exports = { PAGE_SIZE, isObjectId, isPageNumber, escapeRegex, containsText };

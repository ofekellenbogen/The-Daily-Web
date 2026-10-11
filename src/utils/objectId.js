const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

function isObjectId(value) {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

module.exports = { isObjectId };

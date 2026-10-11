const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { splitParagraphs } = require('../../src/modules/public/article.service');
const { getBucket } = require('../../src/modules/analytics/views.service');
const {
  parseCommentInput,
  encodeCursor,
  decodeCursor
} = require('../../src/modules/comments/comments.service');

test('splitParagraphs splits on blank lines and drops empty ones', () => {
  assert.deepEqual(splitParagraphs('first\n\nsecond\n  \nthird\n\n\n'), ['first', 'second', 'third']);
  assert.deepEqual(splitParagraphs(''), []);
  assert.deepEqual(splitParagraphs(undefined), []);
});

test('getBucket maps a time to its UTC day and 5-minute slot', () => {
  const { dayUtc, slot } = getBucket(new Date('2026-10-11T14:07:30.000Z'));
  assert.equal(dayUtc.toISOString(), '2026-10-11T00:00:00.000Z');
  assert.equal(slot, 14 * 12 + 1);
});

test('getBucket uses the last slot just before midnight', () => {
  assert.equal(getBucket(new Date('2026-10-11T23:59:59.999Z')).slot, 287);
});

test('parseCommentInput trims and defaults the guest name', () => {
  assert.deepEqual(parseCommentInput({ authorName: '  ', body: '  שלום  ' }), {
    authorName: 'אורח',
    body: 'שלום'
  });
});

test('parseCommentInput rejects an empty body and over-long fields', () => {
  assert.throws(() => parseCommentInput({ body: '   ' }), (err) => {
    assert.equal(err.status, 400);
    assert.ok(err.fields.body);
    return true;
  });
  assert.throws(() => parseCommentInput({ authorName: 'א'.repeat(51), body: 'x'.repeat(1001) }), (err) => {
    assert.deepEqual(Object.keys(err.fields).sort(), ['authorName', 'body']);
    return true;
  });
});

test('parseCommentInput ignores non-string values and missing bodies', () => {
  assert.throws(() => parseCommentInput(undefined), { status: 400 });
  assert.throws(() => parseCommentInput({ body: { $gt: '' } }), { status: 400 });
});

test('comment cursor round-trips and rejects tampering', () => {
  const comment = { _id: new mongoose.Types.ObjectId(), createdAt: new Date('2026-10-11T10:00:00.000Z') };
  const decoded = decodeCursor(encodeCursor(comment));
  assert.equal(decoded.date.toISOString(), comment.createdAt.toISOString());
  assert.equal(String(decoded.id), String(comment._id));
  assert.throws(() => decodeCursor('garbage'), { status: 400, code: 'INVALID_CURSOR' });
  assert.throws(() => decodeCursor(['a', 'b']), { status: 400 });
});

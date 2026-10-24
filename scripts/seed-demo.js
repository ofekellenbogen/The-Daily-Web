// Demo data top-up: `npm run seed`.
//
// Makes sure the database holds everything the defense needs to demonstrate:
//   - at least 500 articles in different categories
//   - articles in every workflow state: drafts, pending, returned (with an editor note), published
//   - several articles that were updated a few times after publication, and published articles
//     with an update in progress (readers still see the approved version)
//   - comments, and views over time for the Impact Analytics graph
//
// Safe to run again and again: it only ADDS what is missing and never deletes data or changes
// anyone else's data (the one update it makes is giving its own demo articles an image if they
// have none). Each section counts what already exists and adds only the difference.
// View statistics are inserted only for (article, day) pairs that have no document yet, so
// running it on the defense day fills the days since the last run without touching real views.
//
// Users: existing reporters/editors are used. A fresh database without staff accounts needs
// SEED_PASSWORD in .env - the demo accounts are then created with that password.
require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/database');
const Article = require('../src/models/Article');
const Comment = require('../src/models/Comment');
const User = require('../src/models/User');
const ViewStats = require('../src/models/ViewStats');
const { hashPassword } = require('../src/utils/password');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BUCKET_MS = 5 * 60 * 1000;
const SLOTS_PER_DAY = 288;
const VIEW_DAYS = 14; // view statistics are kept up to date for the last 14 days

// "At least this many" of each kind of article.
const TARGETS = {
  totalArticles: 500,
  drafts: 12, // new articles still being written
  pending: 10, // new articles waiting for an editor
  returned: 8, // sent back to the reporter with a note
  multiVersion: 8, // published and updated at least twice (3+ versions)
  updateInProgress: 6 // published, with a newer version being edited or waiting for approval
};

const DEMO_DEVICE = 'seed-demo';

// ===== Deterministic random numbers ================================================
// A seeded generator (mulberry32) gives repeatable "random" data.
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let random = createRandom(1);
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (min, max) => min + Math.floor(random() * (max - min + 1));

// A stable number 0..1 for an article id, so the same article always has the same popularity.
function idWeight(id) {
  return parseInt(String(id).slice(-6), 16) / 0xffffff;
}

// ===== Article content =============================================================
const SUBJECTS = {
  politics: ['מועצת העיר', 'ועדת התכנון המחוזית', 'משרד התחבורה', 'השלטון המקומי', 'ועדת החינוך', 'רשות המים'],
  economy: ['שוק הדיור', 'העסקים הקטנים', 'ענף התיירות', 'שוק העבודה', 'יוקר המחיה', 'החקלאות המקומית'],
  world: ['הסחר הבינלאומי', 'שיתוף הפעולה האזורי', 'משבר האקלים', 'התעופה האזרחית', 'הסטודנטים הזרים', 'נתיבי השיט'],
  tech: ['הבינה המלאכותית', 'אבטחת המידע', 'רשתות הסלולר', 'מחשוב הענן', 'הרכב החשמלי', 'האנרגיה הסולארית'],
  sports: ['ליגת הנוער', 'הכדורגל השכונתי', 'ענף השחייה', 'מרוצי הריצה', 'הכדורסל לנשים', 'ספורט הנכים'],
  culture: ['הקולנוע העצמאי', 'תיאטרון הפרינג\'', 'פסטיבל הספרות', 'המוזיאונים הקטנים', 'סצנת המוזיקה', 'אמנות הרחוב'],
  health: ['רפואת הקהילה', 'בריאות הנפש', 'רפואת הילדים', 'התזונה הנכונה', 'שירותי החירום', 'הרפואה המונעת']
};

const TITLE_TEMPLATES = [
  '{s}: מה צפוי בשבוע הקרוב',
  'דוח חדש חושף נתונים מפתיעים על {s}',
  'ניתוח: חמש שאלות פתוחות סביב {s}',
  '{s} תחת זרקור: המומחים חלוקים',
  'מאחורי הקלעים של {s}',
  'שינוי כיוון? הצעדים הבאים של {s}',
  '{s}: הנתונים המלאים של הרבעון',
  'מדריך: כל מה שצריך לדעת על {s}',
  'דעה: הזדמנות חדשה עבור {s}',
  'סקירה שבועית - {s}',
  '{s} לקראת הכרעה',
  'הקוראים שואלים, המומחים עונים: {s}',
  'תוכנית חדשה עבור {s} יוצאת לדרך',
  'חמש מסקנות מהשנה האחרונה: {s}',
  'מבט מקרוב: {s} בעידן של שינויים'
];

const SENTENCES = [
  'לפי הנתונים שפורסמו השבוע, {s} נמצא בנקודת מפנה משמעותית.',
  'גורמים המעורבים בנושא מסרו כי ההחלטות שיתקבלו בימים הקרובים ישפיעו על הציבור הרחב.',
  'מומחים שעמם שוחחנו מעריכים כי המגמה תימשך גם בחודשים הבאים.',
  'במקביל נשמעים קולות הקוראים לבחון מחדש את המדיניות הקיימת.',
  'הנתונים מצביעים על שינוי עקבי לעומת התקופה המקבילה אשתקד.',
  'הגורמים המעורבים הדגישו את הצורך בשקיפות מלאה מול הציבור.',
  'פרטים נוספים צפויים להתפרסם בהמשך החודש.',
  'לדברי אנשי מקצוע, מדובר באחד השינויים החשובים של השנים האחרונות.',
  'בינתיים, ההתפתחויות סביב {s} ממשיכות לעורר עניין רב.',
  'תושבים רבים כבר מרגישים את ההשפעה בחיי היום-יום.',
  'השלב הראשון ייבחן בהיקף מצומצם לפני החלטה על הרחבה.',
  'מבקרי התוכנית טוענים כי לוח הזמנים אינו מציאותי.'
];

const UPDATE_SENTENCES = [
  'עדכון: בשעות האחרונות התקבלו נתונים חדשים, והכתבה עודכנה בהתאם.',
  'עדכון: הגורמים המעורבים מסרו תגובה רשמית לאחר פרסום הכתבה.',
  'עדכון: הוחלט על הארכת לוח הזמנים בשבועיים נוספים.',
  'עדכון: נוספו פרטים על מספר המשתתפים בשלב הראשון.'
];

const EDITOR_NOTES = [
  'יש להוסיף מקור לנתונים שבפסקה השנייה.',
  'הכותרת ארוכה מדי - נא לקצר ולחדד.',
  'חסרה תגובה של הגורם הרשמי. נא להוסיף לפני הפרסום.',
  'נא להרחיב את התקציר ולבדוק שגיאות כתיב.',
  'הפסקה האחרונה חוזרת על הפתיחה - נא לערוך.'
];

const COMMENT_NAMES = ['רוני', 'מיכל', 'אבי', 'נועה', 'יוסי', 'שירה', 'דוד', 'תמר', 'אורח'];
const COMMENT_BODIES = [
  'כתבה מעניינת מאוד, תודה על הסיקור.',
  'הייתי שמח לקרוא עוד פרטים על ההשפעה בפועל.',
  'סוף סוף מישהו כותב על זה.',
  'לא בטוח שאני מסכים עם המסקנה, אבל נקודת מבט חשובה.',
  'מחכה לעדכונים בהמשך.',
  'האם ידוע מתי יתפרסמו הנתונים המלאים?',
  'מעניין לראות איך זה ישפיע עלינו בשכונה.',
  'תודה, הסבר ברור ומסודר.'
];

function fill(template, subject) {
  return template.replaceAll('{s}', subject);
}

// ===== Images ======================================================================
// Images are reused from articles already in the database: free Wikimedia Commons photos that
// come with their credit, source and license, so the attribution stays correct.
// An empty database has no images, and the site then shows its placeholder picture.
const IMAGE_FIELDS = ['imageUrl', 'imageAlt', 'imageCredit', 'imageSourceUrl', 'imageLicense', 'imageLicenseUrl'];
const NO_IMAGE = Object.fromEntries(IMAGE_FIELDS.map((field) => [field, '']));
let imagePool = {}; // category -> [{ imageUrl, imageAlt, ... }]

async function loadImagePool() {
  const rows = await Article.find({ 'workingCopy.imageUrl': /^https:\/\// })
    .select(IMAGE_FIELDS.map((field) => `workingCopy.${field}`).join(' ') + ' workingCopy.category').lean();
  const seen = new Set();
  imagePool = {};
  for (const { workingCopy: copy } of rows) {
    if (!copy.category || seen.has(copy.imageUrl)) continue;
    seen.add(copy.imageUrl);
    const image = Object.fromEntries(IMAGE_FIELDS.map((field) => [field, copy[field] || '']));
    (imagePool[copy.category] ||= []).push(image);
  }
}

// A random image from the same category (or from any category if that one has none).
function pickImage(category) {
  const images = imagePool[category]?.length ? imagePool[category] : Object.values(imagePool).flat();
  return images.length ? { ...pick(images) } : { ...NO_IMAGE };
}

function makeParagraphs(subject, count) {
  const paragraphs = ['הכתבה מתארת תרחיש בדיוני לצורכי הדגמה.'];
  for (let i = 0; i < count; i += 1) {
    paragraphs.push(Array.from({ length: 3 }, () => fill(pick(SENTENCES), subject)).join(' '));
  }
  return paragraphs;
}

function makeContent(category, subject, title) {
  return {
    title,
    summary: `כתבת הדגמה בדיונית: סקירה של ההתפתחויות האחרונות סביב ${subject} והשלכותיהן על הציבור.`,
    body: makeParagraphs(subject, between(3, 5)).join('\n\n'),
    category,
    ...pickImage(category)
  };
}

// The same article with an "update" paragraph added - used for versions 2, 3, ...
function makeUpdatedContent(content, version) {
  return {
    ...content,
    summary: `${content.summary.replace(/ \(עודכן - גרסה \d+\)$/, '')} (עודכן - גרסה ${version})`,
    body: `${content.body}\n\n${UPDATE_SENTENCES[(version - 2) % UPDATE_SENTENCES.length]}`
  };
}

// ===== Unique titles ===============================================================
// The app rejects duplicate titles (ignoring case and extra spaces), so the seed does too.
const normalizeTitle = (title) => String(title || '').trim().replace(/\s+/g, ' ').toLowerCase();
let usedTitles = new Set();
const titlePool = [];

function buildTitlePool() {
  for (const template of TITLE_TEMPLATES) {
    for (const [category, subjects] of Object.entries(SUBJECTS)) {
      for (const subject of subjects) titlePool.push({ category, subject, title: fill(template, subject) });
    }
  }
  // Shuffle once so consecutive articles get different categories and subjects.
  for (let i = titlePool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [titlePool[i], titlePool[j]] = [titlePool[j], titlePool[i]];
  }
}

function nextTopic() {
  while (titlePool.length) {
    const topic = titlePool.pop();
    if (!usedTitles.has(normalizeTitle(topic.title))) {
      usedTitles.add(normalizeTitle(topic.title));
      return topic;
    }
  }
  throw new Error('No unused demo titles left');
}

// ===== Building and inserting articles =============================================
// published: [{ at, content }] - one entry per approval (version 1, 2, ...), oldest first.
function buildArticle({ authorId, editorId, workingCopy, status, published = [], editorNote = '', createdAt, updatedAt }) {
  const last = published.at(-1);
  return {
    authorId,
    workingCopy,
    workflowStatus: status,
    editorNote,
    revision: published.length * 2 + 1,
    publishedVersion: last ? { ...last.content, version: published.length, publishedAt: last.at } : null,
    publicationHistory: published.map((entry, index) => ({ version: index + 1, publishedAt: entry.at, editorId })),
    createdAt,
    updatedAt
  };
}

// Validates with the Mongoose schema, then inserts directly so our createdAt/updatedAt are kept.
async function insertValidated(Model, items) {
  const docs = [];
  for (const item of items) {
    const doc = new Model(item);
    await doc.validate();
    docs.push(doc.toObject());
  }
  if (docs.length) await Model.collection.insertMany(docs);
  return docs;
}

// A random moment between `fromMs` and `toMs` before `now`.
function agoBetween(now, fromMs, toMs) {
  return new Date(now - toMs - random() * (fromMs - toMs));
}

// ===== Sections ====================================================================
async function ensureUsers() {
  const findStaff = async () => ({
    reporters: await User.find({ role: 'reporter' }).select('_id').lean(),
    editors: await User.find({ role: 'editor' }).select('_id').lean()
  });
  const staff = await findStaff();
  if (staff.reporters.length && staff.editors.length) return staff;

  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('No staff accounts exist. Set SEED_PASSWORD (8+ characters) in .env to create demo accounts.');
  }
  const passwordHash = await hashPassword(password);
  const accounts = [
    ['dana.levi', 'דנה לוי', 'reporter'], ['yossi.cohen', 'יוסי כהן', 'reporter'],
    ['maya.mizrahi', 'מאיה מזרחי', 'reporter'], ['amir.peretz', 'אמיר פרץ', 'reporter'],
    ['editor', 'עורכת ראשית', 'editor']
  ];
  for (const [username, displayName, role] of accounts) {
    await User.updateOne({ username }, { $setOnInsert: { username, displayName, role, passwordHash } }, { upsert: true });
  }
  console.log('[seed] created demo staff accounts');
  return findStaff();
}

async function addWorkflowArticles(users, now) {
  const counts = {
    drafts: await Article.countDocuments({ workflowStatus: 'draft', publishedVersion: null }),
    pending: await Article.countDocuments({ workflowStatus: 'pending', publishedVersion: null }),
    returned: await Article.countDocuments({ workflowStatus: 'returned' })
  };
  const items = [];

  for (let i = counts.drafts; i < TARGETS.drafts; i += 1) {
    const { category, subject, title } = nextTopic();
    const content = makeContent(category, subject, title);
    // Some drafts are still incomplete, like real work in progress.
    if (i % 3 === 0) content.summary = '';
    if (i % 4 === 0) content.body = makeParagraphs(subject, 1).join('\n\n');
    const createdAt = agoBetween(now, 4 * DAY_MS, 2 * HOUR_MS);
    items.push(buildArticle({ authorId: pick(users.reporters)._id, workingCopy: content, status: 'draft',
      createdAt, updatedAt: new Date(Math.min(now, createdAt.getTime() + between(1, 30) * HOUR_MS)) }));
  }

  for (let i = counts.pending; i < TARGETS.pending; i += 1) {
    const { category, subject, title } = nextTopic();
    const createdAt = agoBetween(now, 3 * DAY_MS, 3 * HOUR_MS);
    items.push(buildArticle({ authorId: pick(users.reporters)._id, workingCopy: makeContent(category, subject, title),
      status: 'pending', createdAt, updatedAt: new Date(createdAt.getTime() + HOUR_MS) }));
  }

  for (let i = counts.returned; i < TARGETS.returned; i += 1) {
    const { category, subject, title } = nextTopic();
    const createdAt = agoBetween(now, 5 * DAY_MS, 6 * HOUR_MS);
    items.push(buildArticle({ authorId: pick(users.reporters)._id, workingCopy: makeContent(category, subject, title),
      status: 'returned', editorNote: EDITOR_NOTES[i % EDITOR_NOTES.length],
      createdAt, updatedAt: new Date(createdAt.getTime() + 2 * HOUR_MS) }));
  }

  await insertValidated(Article, items);
  console.log(`[seed] workflow articles: had ${JSON.stringify(counts)}, added ${items.length}`);
}

// Published articles with several approved versions, and published articles with an update in progress.
async function addUpdatedArticles(users, now) {
  const multi = await Article.countDocuments({ 'publicationHistory.2': { $exists: true } });
  const inProgress = await Article.countDocuments({
    publishedVersion: { $ne: null }, workflowStatus: { $in: ['draft', 'pending'] }
  });
  const items = [];

  const addArticle = (versionCount, status) => {
    const { category, subject, title } = nextTopic();
    let content = makeContent(category, subject, title);
    // First publication 9-12 days ago, then an update every 40-60 hours (always in the past).
    let at = agoBetween(now, 12 * DAY_MS, 9 * DAY_MS);
    const published = [{ at, content }];
    for (let version = 2; version <= versionCount; version += 1) {
      at = new Date(at.getTime() + between(40, 60) * HOUR_MS);
      content = makeUpdatedContent(content, version);
      published.push({ at, content });
    }
    // An update in progress: the working copy is ahead of the published version.
    const workingCopy = status === 'published' ? content : makeUpdatedContent(content, versionCount + 1);
    items.push(buildArticle({ authorId: pick(users.reporters)._id, editorId: pick(users.editors)._id,
      workingCopy, status, published, createdAt: new Date(published[0].at.getTime() - 2 * HOUR_MS),
      updatedAt: status === 'published' ? at : new Date(now - between(1, 5) * HOUR_MS) }));
  };

  for (let i = multi; i < TARGETS.multiVersion; i += 1) addArticle(between(3, 4), 'published');
  for (let i = inProgress; i < TARGETS.updateInProgress; i += 1) addArticle(2, i % 3 === 0 ? 'draft' : 'pending');

  const docs = await insertValidated(Article, items);
  console.log(`[seed] updated articles: had ${multi} multi-version + ${inProgress} in progress, added ${docs.length}`);
  return docs;
}

// Ordinary published articles, only when the database has fewer than 500 articles in total.
async function addFillerArticles(users, now) {
  const total = await Article.countDocuments();
  const items = [];
  for (let i = total; i < TARGETS.totalArticles; i += 1) {
    const { category, subject, title } = nextTopic();
    const content = makeContent(category, subject, title);
    const at = agoBetween(now, (VIEW_DAYS - 1) * DAY_MS, HOUR_MS);
    items.push(buildArticle({ authorId: pick(users.reporters)._id, editorId: pick(users.editors)._id,
      workingCopy: content, status: 'published', published: [{ at, content }],
      createdAt: new Date(at.getTime() - 3 * HOUR_MS), updatedAt: at }));
  }
  const docs = await insertValidated(Article, items);
  console.log(`[seed] filler articles: had ${total}, added ${docs.length}`);
  return docs;
}

// A few comments on every newly published demo article.
async function addComments(articles, now) {
  const items = [];
  for (const article of articles) {
    if (!article.publicationHistory.length) continue;
    const firstPublished = article.publicationHistory[0].publishedAt.getTime();
    for (let i = between(3, 7); i > 0; i -= 1) {
      const at = new Date(firstPublished + random() * (now - firstPublished));
      items.push({ articleId: article._id, authorName: pick(COMMENT_NAMES), body: pick(COMMENT_BODIES),
        deviceId: DEMO_DEVICE, createdAt: at, updatedAt: at });
    }
  }
  await insertValidated(Comment, items);
  console.log(`[seed] comments added: ${items.length}`);
}

// Demo articles from an earlier run that were created without an image get one now
// (both the working copy and the published version, which share the same image).
async function addMissingImages() {
  if (!Object.keys(imagePool).length) return;
  // Every title this script can produce; other articles can't have them (duplicates are rejected).
  const seedTitles = TITLE_TEMPLATES.flatMap((template) =>
    Object.values(SUBJECTS).flat().map((subject) => fill(template, subject)));
  const articles = await Article.find({
    'workingCopy.title': { $in: seedTitles },
    'workingCopy.imageUrl': ''
  }).select('workingCopy.category publishedVersion').lean();

  const operations = articles.map((article) => {
    const image = pickImage(article.workingCopy.category);
    const update = {};
    for (const field of IMAGE_FIELDS) {
      update[`workingCopy.${field}`] = image[field];
      if (article.publishedVersion) update[`publishedVersion.${field}`] = image[field];
    }
    return { updateOne: { filter: { _id: article._id }, update: { $set: update } } };
  });
  if (operations.length) await Article.collection.bulkWrite(operations);
  console.log(`[seed] images added to ${operations.length} demo articles`);
}

// ===== View statistics =============================================================
// Share of the day's views per 5-minute slot: quiet at night, peaks in the morning and evening
// (Israel time, about UTC+3 - close enough for demo data).
const SLOT_WEIGHTS = Array.from({ length: SLOTS_PER_DAY }, (_, slot) => {
  const hour = (Math.floor(slot / 12) + 3) % 24;
  if (hour < 6) return 0.2;
  if ((hour >= 7 && hour < 10) || (hour >= 19 && hour < 23)) return 1.6;
  return 1;
});
const WEIGHT_SUM = SLOT_WEIGHTS.reduce((sum, weight) => sum + weight, 0);

// Views of one article on one UTC day, as { buckets, total }, or null when there are none.
// Every approved update brings a wave of extra readers that fades over about a day - this is
// what Impact Analytics shows around the publication markers.
function buildDayViews(article, dayStart, now) {
  const events = article.publicationHistory.map((event) => new Date(event.publishedAt).getTime());
  const [firstPublished, ...updates] = events;
  const dailyViews = 120 + idWeight(article._id) * 300; // like the existing data: ~120-420 a day
  const buckets = {};
  let total = 0;

  for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
    const time = dayStart + slot * BUCKET_MS;
    if (time < firstPublished || time > now) continue;
    // New articles get more readers in their first days.
    const ageDays = (time - firstPublished) / DAY_MS;
    let rate = dailyViews * (SLOT_WEIGHTS[slot] / WEIGHT_SUM) * (0.6 + 0.8 * Math.exp(-ageDays / 4));
    for (const update of updates) {
      if (time >= update) rate *= 1 + 2.5 * Math.exp(-(time - update) / (8 * HOUR_MS));
    }
    const count = Math.floor(rate + random());
    if (count > 0) {
      buckets[slot] = count;
      total += count;
    }
  }
  return total ? { buckets, total } : null;
}

// Inserts a day of views only where no document exists ($setOnInsert): real views are never changed.
async function topUpViews(now) {
  const today = now - (now % DAY_MS);
  const firstDay = today - (VIEW_DAYS - 1) * DAY_MS;
  const articles = await Article.find({ 'publicationHistory.0': { $exists: true } }).select('publicationHistory').lean();

  let operations = [];
  let inserted = 0;
  const flush = async () => {
    if (!operations.length) return;
    const result = await ViewStats.collection.bulkWrite(operations, { ordered: false });
    inserted += result.upsertedCount;
    operations = [];
  };

  for (const article of articles) {
    for (let day = firstDay; day <= today; day += DAY_MS) {
      const views = buildDayViews(article, day, now);
      if (!views) continue;
      operations.push({
        updateOne: {
          filter: { articleId: article._id, dayUtc: new Date(day) },
          update: { $setOnInsert: { total: views.total, buckets: views.buckets } },
          upsert: true
        }
      });
      if (operations.length >= 1000) await flush();
    }
  }
  await flush();
  console.log(`[seed] view statistics: ${inserted} article-days added for ${articles.length} published articles`);
}

// ===== Main ========================================================================
async function main() {
  await connectDatabase(process.env.MONGODB_URI);
  const now = Date.now();
  // A different sequence per day, so re-running on another day doesn't repeat the same values.
  random = createRandom(Math.floor(now / DAY_MS));

  const existing = await Article.find().select('workingCopy.title publishedVersion.title').lean();
  usedTitles = new Set(existing.flatMap((article) => [article.workingCopy?.title, article.publishedVersion?.title])
    .filter(Boolean).map(normalizeTitle));
  buildTitlePool();
  await loadImagePool();

  const users = await ensureUsers();
  await addMissingImages();
  await addWorkflowArticles(users, now);
  const updated = await addUpdatedArticles(users, now);
  const filler = await addFillerArticles(users, now);
  await addComments([...updated, ...filler], now);
  await topUpViews(now);
  console.log('[seed] done');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

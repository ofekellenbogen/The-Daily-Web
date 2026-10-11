require('dotenv').config();

const mongoose = require('mongoose');
const { connectDb } = require('../../src/config/db');
const User = require('../../src/models/User');
const Article = require('../../src/models/Article');
const ViewStats = require('../../src/models/ViewStats');
const Comment = require('../../src/models/Comment');

const { CATEGORIES } = Article;

const ARTICLE_COUNT = 520;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_STATS_DAYS = 14;

// Login is implemented in the auth task; these accounts get a real password there.
const NO_PASSWORD = '!no-password-set';

const DEMO_USERS = [
  { username: 'dana.levi', displayName: 'דנה לוי', role: 'reporter' },
  { username: 'yossi.cohen', displayName: 'יוסי כהן', role: 'reporter' },
  { username: 'maya.mizrahi', displayName: 'מאיה מזרחי', role: 'reporter' },
  { username: 'amir.peretz', displayName: 'אמיר פרץ', role: 'reporter' },
  { username: 'editor', displayName: 'נועה אברהם', role: 'editor' }
];

const SUBJECTS = {
  politics: ['הממשלה', 'הכנסת', 'ועדת הכספים', 'ראש העירייה', 'האופוזיציה'],
  economy: ['בנק ישראל', 'הבורסה בתל אביב', 'שוק הדיור', 'חברות ההייטק', 'משרד האוצר'],
  world: ['האיחוד האירופי', 'האו"ם', 'הבית הלבן', 'ממשלת יפן', 'מדינות ה-G20'],
  tech: ['סטארט-אפ ישראלי', 'ענקית הטכנולוגיה', 'חוקרי הבינה המלאכותית', 'רשות הסייבר', 'יצרנית השבבים'],
  sports: ['נבחרת ישראל', 'מכבי תל אביב', 'הפועל באר שבע', 'שחקנית הטניס', 'אצן המרתון'],
  culture: ['התיאטרון הלאומי', 'פסטיבל הקולנוע', 'הזמרת המצליחה', 'מוזיאון ישראל', 'הסופר הוותיק'],
  health: ['משרד הבריאות', 'חוקרים מהטכניון', 'קופות החולים', 'בית החולים', 'ארגון הבריאות העולמי']
};

const ACTIONS = [
  'מציגים תוכנית חדשה לשנה הקרובה',
  'מודיעים על שינוי דרמטי',
  'חושפים נתונים מפתיעים',
  'נערכים לקראת אתגר משמעותי',
  'משיקים יוזמה חסרת תקדים',
  'מגיבים לביקורת הציבורית',
  'שוברים שיא חדש',
  'מסכמים שנה של הישגים'
];

const COMMENTERS = ['אורח', 'רוני', 'מיכל', 'אבי', 'שירה', 'דוד', 'קורא קבוע', 'תמר'];

const COMMENT_TEXTS = [
  'כתבה מעניינת, תודה!',
  'מעניין לראות איך זה יתפתח בשבועות הקרובים.',
  'לא בטוח שאני מסכים, אבל זו נקודה חשובה.',
  'חסרים פה נתונים, אשמח לעדכון.',
  'סוף סוף מישהו כותב על זה.',
  'שאלה טובה מה ההשלכות לטווח הארוך.'
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(items) {
  return items[randomInt(0, items.length - 1)];
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function buildContent(index) {
  const category = pick(Object.keys(CATEGORIES));
  const subject = pick(SUBJECTS[category]);
  const action = pick(ACTIONS);
  const title = `${subject} ${action}`;
  const summary = `${subject} בכותרות: כל מה שצריך לדעת על ההתפתחויות האחרונות בתחום ה${CATEGORIES[category]}.`;
  const body = [
    `${subject} עמדו היום במרכז תשומת הלב בעקבות ההתפתחויות האחרונות.`,
    'גורמים בכירים מסרו כי ההחלטה התקבלה לאחר דיונים ממושכים, וכי ההשלכות צפויות להיות מורגשות כבר בשבועות הקרובים.',
    'מומחים שעמם שוחחנו מעריכים כי מדובר בצעד משמעותי, אך מזהירים שעדיין מוקדם להעריך את מלוא השפעתו.'
  ].join('\n\n');
  // picsum.photos serves free Unsplash-licensed photos; the seed keeps each image stable.
  const imageUrl = `https://picsum.photos/seed/dailyweb-${index}/640/360`;
  return { title, summary, body, category, imageUrl };
}

function buildArticle(index, reporters, editor, now) {
  const authorId = pick(reporters)._id;
  const content = buildContent(index);
  const roll = Math.random();

  // About 15% were never published (in progress, waiting or returned).
  if (roll < 0.15) {
    const workflowStatus = pick(['draft', 'pending', 'returned']);
    return {
      authorId,
      workingCopy: content,
      workflowStatus,
      editorNote: workflowStatus === 'returned' ? 'נא לחדד את הכותרת ולהוסיף מקור.' : '',
      revision: randomInt(1, 10)
    };
  }

  const firstPublishedAt = new Date(now - randomInt(1, 60 * 24 * 60) * 60 * 1000);
  const updateCount = Math.random() < 0.08 ? randomInt(1, 3) : 0;
  const publicationHistory = [{ version: 1, publishedAt: firstPublishedAt, editorId: editor._id }];
  for (let version = 2; version <= updateCount + 1; version++) {
    const previous = publicationHistory[publicationHistory.length - 1].publishedAt.getTime();
    const publishedAt = new Date(Math.min(now, previous + randomInt(2, 48) * 60 * 60 * 1000));
    publicationHistory.push({ version, publishedAt, editorId: editor._id });
  }

  const latest = publicationHistory[publicationHistory.length - 1];
  const publishedTitle = latest.version > 1 ? `${content.title} (עודכן)` : content.title;
  const publishedVersion = { ...content, title: publishedTitle, version: latest.version, publishedAt: latest.publishedAt };

  // Some published articles have a newer edit in progress that the public must not see.
  const hasPendingEdit = Math.random() < 0.1;
  return {
    authorId,
    workingCopy: hasPendingEdit ? { ...content, title: `טיוטת עדכון: ${content.title}` } : content,
    publishedVersion,
    workflowStatus: hasPendingEdit ? pick(['draft', 'pending', 'returned']) : 'published',
    revision: randomInt(1, 20),
    publicationHistory
  };
}

function splitIntoBuckets(total, maxBucket) {
  const buckets = {};
  let remaining = total;
  for (let i = 0; i < 6 && remaining > 0; i++) {
    const amount = i === 5 ? remaining : randomInt(0, remaining);
    if (amount > 0) {
      const slot = randomInt(0, maxBucket);
      buckets[slot] = (buckets[slot] || 0) + amount;
      remaining -= amount;
    }
  }
  if (remaining > 0) {
    const slot = randomInt(0, maxBucket);
    buckets[slot] = (buckets[slot] || 0) + remaining;
  }
  return buckets;
}

function buildViewStats(articles, now) {
  const today = startOfUtcDay(new Date(now));
  const currentBucket = Math.floor((now - today.getTime()) / (5 * 60 * 1000));
  const stats = [];

  for (const article of articles) {
    if (!article.publishedVersion) continue;
    const popularity = Math.random() ** 2 * 400;
    const firstDay = startOfUtcDay(article.publicationHistory[0].publishedAt);
    const days = Math.min(MAX_STATS_DAYS, Math.round((today - firstDay) / DAY_MS) + 1);

    for (let d = 0; d < days; d++) {
      const dayUtc = new Date(firstDay.getTime() + d * DAY_MS);
      const total = Math.round(popularity / (d + 1) + randomInt(0, 10));
      if (total === 0) continue;
      const maxBucket = dayUtc.getTime() === today.getTime() ? currentBucket : 287;
      stats.push({ articleId: article._id, dayUtc, total, buckets: splitIntoBuckets(total, maxBucket) });
    }
  }
  return stats;
}

function buildComments(articles, now) {
  const comments = [];
  for (const article of articles) {
    if (!article.publishedVersion) continue;
    const firstPublishedAt = article.publicationHistory[0].publishedAt.getTime();
    const count = randomInt(0, 5);
    for (let i = 0; i < count; i++) {
      const createdAt = new Date(randomInt(firstPublishedAt, now));
      comments.push({
        articleId: article._id,
        authorName: pick(COMMENTERS),
        body: pick(COMMENT_TEXTS),
        deviceId: 'seed',
        createdAt,
        updatedAt: createdAt
      });
    }
  }
  return comments;
}

async function seed() {
  await connectDb(process.env.MONGODB_URI);
  const now = Date.now();

  const users = [];
  for (const demoUser of DEMO_USERS) {
    const user = await User.findOneAndUpdate(
      { username: demoUser.username },
      { $set: demoUser, $setOnInsert: { passwordHash: NO_PASSWORD } },
      { upsert: true, returnDocument: 'after' }
    );
    users.push(user);
  }
  const reporters = users.filter((user) => user.role === 'reporter');
  const editor = users.find((user) => user.role === 'editor');

  // Only data owned by the demo users is replaced, so other seeds are left intact.
  const oldArticleIds = await Article.find({ authorId: { $in: reporters.map((r) => r._id) } }).distinct('_id');
  await ViewStats.deleteMany({ articleId: { $in: oldArticleIds } });
  await Comment.deleteMany({ articleId: { $in: oldArticleIds } });
  await Article.deleteMany({ _id: { $in: oldArticleIds } });

  const articleDocs = [];
  for (let i = 0; i < ARTICLE_COUNT; i++) {
    articleDocs.push(buildArticle(i, reporters, editor, now));
  }
  const articles = await Article.insertMany(articleDocs);
  const stats = buildViewStats(articles, now);
  await ViewStats.insertMany(stats);
  // Timestamps are generated above, so Mongoose must not overwrite them with the current time.
  const comments = await Comment.insertMany(buildComments(articles, now), { timestamps: false });

  const publishedCount = articles.filter((a) => a.publishedVersion).length;
  console.log(
    `[seed] ${users.length} users, ${articles.length} articles (${publishedCount} public), ` +
      `${stats.length} view-stat days, ${comments.length} comments`
  );
}

seed()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

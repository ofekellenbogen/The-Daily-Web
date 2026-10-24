// Public article page.
const articleService = require('../services/article.service');
const commentService = require('../services/comment.service');
const viewTracking = require('../services/viewTracking.service');
const { renderArticleIllustration } = require('../services/articleImage.service');
const logger = require('../utils/logger');

// Dates are shown in Israel time, e.g. "24 באוק׳ 2026, 14:00".
const dateFormatter = new Intl.DateTimeFormat('he-IL', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jerusalem'
});

function formatDate(value) {
  return dateFormatter.format(new Date(value));
}

// GET /articles/:id
// The full article is rendered on the server (EJS), so search engines get the complete
// content in the first HTML response without running JavaScript.
async function renderArticle(req, res) {
  const article = await articleService.getPublicArticle(req.params.id);

  // These three run in parallel.
  const [comments, commentCount] = await Promise.all([
    commentService.listComments(article.id),
    commentService.countComments(article.id),
    // Every visit counts as a view. If recording fails we only log it - the reader still gets the article.
    viewTracking.recordVisit(article.id, req.deviceId).catch((err) => {
      logger.error('[views] View recording failed; article remains available', err, { articleId: article.id });
    })
  ]);

  res.render('public/article', {
    title: `${article.title} | The Daily Web`,
    article,
    comments,
    commentCount,
    formatDate
  });
}

// GET /article-images/:id.svg - the generated illustration for an article.
async function renderArticleImage(req, res) {
  const article = await articleService.getPublicArticle(req.params.id);
  res.type('image/svg+xml')
    .set('Cache-Control', 'public, max-age=31536000, immutable') // browsers may cache it for a year
    .send(renderArticleIllustration(article));
}

module.exports = { renderArticle, renderArticleImage };

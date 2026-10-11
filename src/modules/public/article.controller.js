const articleService = require('./article.service');
const commentsService = require('../comments/comments.service');
const viewsAdapter = require('./views.adapter');

const dateFormatter = new Intl.DateTimeFormat('he-IL', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jerusalem'
});

function formatDate(value) {
  return dateFormatter.format(new Date(value));
}

async function renderArticle(req, res) {
  const article = await articleService.getPublicArticle(req.params.id);

  const [comments, commentCount] = await Promise.all([
    commentsService.listComments(article.id),
    commentsService.countComments(article.id),
    // A failure in view tracking is logged but must not stop the reader from getting the article.
    viewsAdapter.recordVisit(article.id, req.deviceId).catch((err) => {
      console.error(`[views] failed to record a visit to ${article.id}`, err);
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

module.exports = { renderArticle };

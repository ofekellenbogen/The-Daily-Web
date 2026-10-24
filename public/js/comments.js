// Comments section of a public article page (views/public/article.ejs).
//
// Responsibilities:
//   1. New comment - the form is sent with fetch (POST /api/articles/:id/comments) and the
//      new comment is added to the top of the list without reloading the page.
//   2. Load more - the "more comments" button loads the next page of older comments
//      (GET /api/articles/:id/comments?cursor=...).
//   3. Moderation - staff who may moderate see a delete button on every comment
//      (DELETE /api/admin/comments/:id).
(function () {
  'use strict';

  // ===== Page elements =============================================================
  const section = document.getElementById('comments');
  // Pages without a comments section don't need this script.
  if (!section) return;

  const apiUrl = '/api/articles/' + encodeURIComponent(section.dataset.articleId) + '/comments';
  const form = document.getElementById('comment-form');
  const submitButton = form.querySelector('button[type="submit"]');
  const statusText = document.getElementById('comment-status');
  const list = document.getElementById('comment-list');
  const emptyText = document.getElementById('comments-empty');
  const countText = document.getElementById('comments-count');
  const moreButton = document.getElementById('comments-more');

  const dateFormatter = new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jerusalem'
  });

  // ===== State =====================================================================
  // The server renders the first page; it tells us where the next page starts.
  let nextCursor = section.dataset.nextCursor || null;
  let sending = false; // a new comment is being sent (prevents double submit)
  let loadingMore = false; // a "load more" request is running

  // ===== Helpers ===================================================================
  function setStatus(message, isError) {
    statusText.textContent = message;
    statusText.classList.toggle('comment-form__status--error', Boolean(isError));
  }

  // Reads the JSON body; throws an Error with the server's Hebrew message on failure.
  async function readJson(response) {
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      throw new Error((body && body.error && body.error.message) || 'הפעולה נכשלה, נסו שוב.');
    }
    return body;
  }

  // ===== Rendering =================================================================
  // Comment text is user input, so it is only ever inserted with textContent (prevents XSS).
  function renderComment(comment) {
    const item = document.createElement('li');
    item.className = 'comment';

    const meta = document.createElement('header');
    meta.className = 'comment__meta';
    const author = document.createElement('strong');
    author.textContent = comment.authorName;
    const time = document.createElement('time');
    time.dateTime = comment.createdAt;
    time.textContent = dateFormatter.format(new Date(comment.createdAt));
    meta.append(author, time);

    const body = document.createElement('p');
    body.className = 'comment__body';
    body.textContent = comment.body;

    item.append(meta, body);
    // Only moderators get a delete button (the server checks the permission again).
    if (section.dataset.canModerate === 'true') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button button--secondary';
      remove.dataset.deleteComment = comment.id;
      remove.textContent = 'מחיקת תגובה';
      item.append(remove);
    }
    return item;
  }

  // ===== Deleting a comment (moderators only) ======================================
  // One listener on the whole list handles the delete buttons of all comments,
  // including comments that are added later (event delegation).
  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete-comment]');
    if (!button || section.dataset.canModerate !== 'true' || button.disabled) return;
    if (!confirm('למחוק את התגובה?')) return;

    button.disabled = true;
    try {
      const commentId = button.dataset.deleteComment;
      const response = await fetch('/api/admin/comments/' + encodeURIComponent(commentId), {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      // A successful delete has no body; on failure readJson throws the server's message.
      if (!response.ok) await readJson(response);

      button.closest('.comment').remove();
      const count = Math.max(0, Number(countText.textContent) - 1);
      countText.textContent = String(count);
      emptyText.hidden = count !== 0;
      setStatus('התגובה נמחקה.');
    } catch (error) {
      setStatus(error.message, true);
      button.disabled = false;
    }
  });

  // ===== Posting a new comment =====================================================
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;

    const authorName = form.elements.authorName.value.trim();
    const body = form.elements.body.value.trim();
    if (!body) {
      setStatus('יש לכתוב את תוכן התגובה.', true);
      form.elements.body.focus();
      return;
    }

    sending = true;
    submitButton.disabled = true;
    setStatus('שולח...');
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ authorName, body })
      });
      const result = await readJson(response);

      // Only the new comment is added; the rest of the list is not reloaded.
      list.prepend(renderComment(result.data));
      countText.textContent = String(Number(countText.textContent) + 1);
      emptyText.hidden = true;
      form.elements.body.value = '';
      setStatus('התגובה פורסמה.');
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      sending = false;
      submitButton.disabled = false;
    }
  });

  // ===== Loading older comments ====================================================
  moreButton.addEventListener('click', async () => {
    if (loadingMore || !nextCursor) return;
    loadingMore = true;
    moreButton.disabled = true;
    try {
      const response = await fetch(apiUrl + '?cursor=' + encodeURIComponent(nextCursor), {
        headers: { Accept: 'application/json' }
      });
      const result = await readJson(response);

      // Build all new items off-screen first, then add them to the page in one step.
      const fragment = document.createDocumentFragment();
      result.data.forEach((comment) => fragment.appendChild(renderComment(comment)));
      list.appendChild(fragment);

      nextCursor = result.meta.nextCursor;
      moreButton.hidden = !result.meta.hasMore;
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      loadingMore = false;
      moreButton.disabled = false;
    }
  });
})();

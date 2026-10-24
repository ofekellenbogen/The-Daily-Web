(function () {
  'use strict';

  const section = document.getElementById('comments');
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

  let nextCursor = section.dataset.nextCursor || null;
  let sending = false;
  let loadingMore = false;

  function setStatus(message, isError) {
    statusText.textContent = message;
    statusText.classList.toggle('comment-form__status--error', Boolean(isError));
  }

  // Comment text is user input, so it is only ever inserted with textContent.
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

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete-comment]');
    if (!button || section.dataset.canModerate !== 'true' || button.disabled) return;
    if (!confirm('למחוק את התגובה?')) return;
    button.disabled = true;
    try {
      const response = await fetch('/api/admin/comments/' + encodeURIComponent(button.dataset.deleteComment), {
        method: 'DELETE', headers: { Accept: 'application/json' }
      });
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

  async function readJson(response) {
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      throw new Error((body && body.error && body.error.message) || 'הפעולה נכשלה, נסו שוב.');
    }
    return body;
  }

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

  moreButton.addEventListener('click', async () => {
    if (loadingMore || !nextCursor) return;
    loadingMore = true;
    moreButton.disabled = true;
    try {
      const response = await fetch(apiUrl + '?cursor=' + encodeURIComponent(nextCursor), {
        headers: { Accept: 'application/json' }
      });
      const result = await readJson(response);
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

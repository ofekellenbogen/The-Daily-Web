(function () {
  'use strict';

  const SEARCH_DELAY_MS = 350;
  const PRELOAD_MARGIN_PX = 600;

  const form = document.getElementById('feed-controls');
  const list = document.getElementById('feed-list');
  const statusText = document.getElementById('feed-status');
  const retryButton = document.getElementById('feed-retry');
  const sentinel = document.getElementById('feed-sentinel');

  const dateFormatter = new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jerusalem'
  });

  let cursor = null;
  let hasMore = true;
  let paused = false;
  // The controller of the request in flight; a response from any other request is stale.
  let activeRequest = null;
  let searchTimer = null;

  function setStatus(message, isError) {
    statusText.textContent = message;
    statusText.classList.toggle('feed-status--error', Boolean(isError));
  }

  function buildParams() {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      const text = String(value).trim();
      if (text) params.set(key, text);
    }
    if (cursor) params.set('cursor', cursor);
    return params;
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function renderCard(article) {
    const item = document.createElement('li');
    const card = createElement('article', 'card');
    const link = createElement('a', 'card__link');
    link.href = '/articles/' + encodeURIComponent(article.id);

    if (article.imageUrl) {
      const image = createElement('img', 'card__image');
      image.src = article.imageUrl;
      image.alt = article.imageAlt || '';
      image.loading = 'lazy';
      image.width = 640;
      image.height = 360;
      link.appendChild(image);
    }

    const body = createElement('div', 'card__body');
    body.appendChild(createElement('span', 'card__category', article.categoryLabel));
    body.appendChild(createElement('h2', 'card__title', article.title));
    body.appendChild(createElement('p', 'card__summary', article.summary));

    const meta = createElement('footer', 'card__meta');
    meta.appendChild(createElement('span', 'card__author', article.authorName));
    const time = createElement('time', 'card__date', dateFormatter.format(new Date(article.publishedAt)));
    time.dateTime = article.publishedAt;
    meta.appendChild(time);
    body.appendChild(meta);

    link.appendChild(body);
    card.appendChild(link);
    item.appendChild(card);
    return item;
  }

  function showEndState() {
    if (hasMore) {
      setStatus('');
    } else if (list.children.length === 0) {
      setStatus('לא נמצאו כתבות מתאימות.');
    } else {
      setStatus('הגעת לסוף הפיד.');
    }
  }

  function isSentinelNearViewport() {
    return sentinel.getBoundingClientRect().top < window.innerHeight + PRELOAD_MARGIN_PX;
  }

  async function loadNextPage() {
    if (activeRequest || !hasMore || paused) return;

    const request = new AbortController();
    activeRequest = request;
    retryButton.hidden = true;
    setStatus('טוען כתבות...');

    try {
      const response = await fetch('/api/articles?' + buildParams(), {
        signal: request.signal,
        headers: { Accept: 'application/json' }
      });
      const body = await response.json().catch(() => null);
      if (request !== activeRequest) return;

      // The server's popularity snapshot expired: start the list over.
      if (response.status === 409) {
        activeRequest = null;
        restart();
        return;
      }
      if (!response.ok || !body) {
        throw new Error((body && body.error && body.error.message) || 'טעינת הכתבות נכשלה.');
      }

      const fragment = document.createDocumentFragment();
      body.data.forEach((article) => fragment.appendChild(renderCard(article)));
      list.appendChild(fragment);

      cursor = body.meta.nextCursor;
      hasMore = body.meta.hasMore;
      showEndState();
    } catch (error) {
      if (error.name === 'AbortError' || request !== activeRequest) return;
      paused = true;
      setStatus(error.message || 'טעינת הכתבות נכשלה.', true);
      retryButton.hidden = false;
    } finally {
      if (request === activeRequest) activeRequest = null;
    }

    // On tall screens one page may not fill the view, so the observer won't fire again.
    if (!activeRequest && hasMore && !paused && isSentinelNearViewport()) {
      loadNextPage();
    }
  }

  function restart() {
    if (activeRequest) activeRequest.abort();
    activeRequest = null;
    cursor = null;
    hasMore = true;
    paused = false;
    list.replaceChildren();
    loadNextPage();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(searchTimer);
    restart();
  });

  form.addEventListener('input', (event) => {
    if (event.target.name !== 'q') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(restart, SEARCH_DELAY_MS);
  });

  form.addEventListener('change', (event) => {
    if (event.target.tagName === 'SELECT') restart();
  });

  retryButton.addEventListener('click', () => {
    paused = false;
    loadNextPage();
  });

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) loadNextPage();
    },
    { rootMargin: '0px 0px ' + PRELOAD_MARGIN_PX + 'px 0px' }
  );
  observer.observe(sentinel);

  loadNextPage();
})();

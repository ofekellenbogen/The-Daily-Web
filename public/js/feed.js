// Home page news feed (views/public/home.ejs).
//
// Responsibilities:
//   1. Infinite scroll - loads articles page by page from GET /api/articles when the
//      user scrolls near the end of the list (IntersectionObserver on a "sentinel" element).
//   2. Filters - search text (with a short delay while typing) and select boxes
//      (category / seen / sort) restart the feed from the first page.
//   3. Errors - a failed page pauses loading and shows a "retry" button.
(function () {
  'use strict';

  // ===== Constants and page elements ===============================================
  const SEARCH_DELAY_MS = 350;
  // Start loading the next page when the end of the list is this close to the screen.
  const PRELOAD_MARGIN_PX = 600;

  const form = document.getElementById('feed-controls');
  const list = document.getElementById('feed-list');
  const statusText = document.getElementById('feed-status');
  const retryButton = document.getElementById('feed-retry');
  // An empty element after the list; when it becomes visible, the next page is loaded.
  const sentinel = document.getElementById('feed-sentinel');

  const dateFormatter = new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jerusalem'
  });

  // ===== State =====================================================================
  let cursor = null; // where the next page starts (returned by the server)
  let hasMore = true; // false after the last page was loaded
  let paused = false; // true after an error, until the user clicks "retry"
  // The controller of the request in flight; a response from any other request is stale.
  let activeRequest = null;
  let searchTimer = null;

  // ===== Helpers ===================================================================
  function setStatus(message, isError) {
    statusText.textContent = message;
    statusText.classList.toggle('feed-status--error', Boolean(isError));
  }

  // Turns the filter form into query-string parameters (empty fields are skipped).
  function buildParams() {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      const text = String(value).trim();
      if (text) params.set(key, text);
    }
    if (cursor) params.set('cursor', cursor);
    return params;
  }

  // Small helper: creates an element with an optional class and text.
  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  // ===== Rendering =================================================================
  // Builds one article card. All text goes through textContent, never innerHTML.
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
      // A fixed size reserves the space before the image loads, so the page doesn't jump.
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

  // Status line under the list after a page was loaded.
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

  // ===== Loading pages =============================================================
  async function loadNextPage() {
    // Only one request at a time, and nothing to do after the last page or an error.
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
      // A newer request (e.g. a new search) replaced this one: ignore this answer.
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

      // Build all cards off-screen first, then add them to the page in one step.
      const fragment = document.createDocumentFragment();
      body.data.forEach((article) => fragment.appendChild(renderCard(article)));
      list.appendChild(fragment);

      cursor = body.meta.nextCursor;
      hasMore = body.meta.hasMore;
      showEndState();
    } catch (error) {
      // A cancelled or outdated request is not an error the user needs to see.
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

  // Starts the feed over from the first page (after a filter change or an expired snapshot).
  function restart() {
    if (activeRequest) activeRequest.abort();
    activeRequest = null;
    cursor = null;
    hasMore = true;
    paused = false;
    list.replaceChildren();
    loadNextPage();
  }

  // ===== Event listeners ===========================================================
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(searchTimer);
    restart();
  });

  // Typing in the search box restarts the feed only after the user stops typing.
  form.addEventListener('input', (event) => {
    if (event.target.name !== 'q') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(restart, SEARCH_DELAY_MS);
  });

  // Select boxes (category / seen / sort) apply immediately.
  form.addEventListener('change', (event) => {
    if (event.target.tagName === 'SELECT') restart();
  });

  retryButton.addEventListener('click', () => {
    paused = false;
    loadNextPage();
  });

  // Loads the next page when the sentinel gets within PRELOAD_MARGIN_PX of the screen.
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) loadNextPage();
    },
    { rootMargin: '0px 0px ' + PRELOAD_MARGIN_PX + 'px 0px' }
  );
  observer.observe(sentinel);

  // First page.
  loadNextPage();
})();

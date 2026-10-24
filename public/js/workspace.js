// Staff workspace page (views/staff/workspace.ejs) - the list of articles of a reporter/editor.
//
// Responsibilities:
//   1. Filters - a status select and a title search (with a short delay while typing)
//      reload the list from GET /api/staff/articles?page=1&status=...&q=...
//      The chosen filters are also written to the page URL, so a refresh keeps them.
//   2. Load more - the "more" button appends the next page, using the same filters
//      that produced the current list.
//   3. Stale answers - only the newest request may update the page; older ones are
//      cancelled (AbortController) or ignored (request counter).

// ===== Page elements and state =====================================================
const list = document.getElementById('workspace-articles');
const moreButton = document.getElementById('workspace-more');
const statusText = document.getElementById('workspace-status');
// The filter form may be missing, so it is always used with "?.".
const filterForm = document.getElementById('workspace-filter');
const SEARCH_DELAY_MS = 350;

let latestRequestId = 0; // increases on every request; older answers are ignored
let activeRequest = null; // AbortController of the request in flight
let searchTimer = null; // debounce timer of the title search (null = no search waiting)

// ===== Filters =====================================================================
// Reads the filter form into query-string parameters (empty values are skipped).
function filterParams() {
  const params = new URLSearchParams();
  const status = filterForm?.elements.status.value;
  const query = filterForm?.elements.q?.value.trim();
  if (status) params.set('status', status);
  if (query) params.set('q', query);
  return params;
}

// The filters of the list currently shown; "load more" must keep using them,
// even if the user changed the form without applying it yet.
let appliedFilters = filterParams();

// ===== Rendering ===================================================================
function articleCard(article, statusLabels) {
  const item = document.createElement('li');
  const card = document.createElement('article');
  card.className = 'staff-card workspace-card';
  card.dataset.workflowStatus = article.workflowStatus;

  if (article.imageUrl) {
    const image = document.createElement('img');
    image.className = 'workspace-card__image';
    image.src = article.imageUrl;
    image.alt = article.imageAlt || '';
    image.loading = 'lazy';
    card.append(image);
  } else {
    // No image: show a decorative placeholder with the site name.
    const placeholder = document.createElement('div');
    placeholder.className = 'workspace-card__image workspace-card__image--empty';
    placeholder.setAttribute?.('aria-hidden', 'true');
    placeholder.textContent = 'The Daily Web';
    card.append(placeholder);
  }

  const heading = document.createElement('h2');
  const link = document.createElement('a');
  link.href = `/staff/articles/${article._id}`;
  link.textContent = article.workingCopy.title || 'ללא כותרת';
  heading.append(link);
  card.append(heading);

  const details = [`מצב: ${statusLabels[article.workflowStatus]}`];
  // Editors see articles of all reporters, so they also need the author's name.
  if (list.dataset.role === 'editor') {
    details.push(`כתב: ${article.authorId?.displayName || 'משתמש לא זמין'}`);
  }
  if (article.editorNote) {
    details.push(`הערת עורך: ${article.editorNote}`);
  }
  for (const text of details) {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    card.append(paragraph);
  }

  item.append(card);
  return item;
}

// ===== Loading articles ============================================================
// append = true  -> "load more": add the next page to the end of the list.
// append = false -> new filters: replace the list with page 1.
async function loadArticles(append) {
  // Don't load more while another request runs, a search is waiting, or there is no next page.
  if (append && (activeRequest || searchTimer !== null || !moreButton.dataset.nextPage)) return;

  activeRequest?.abort();
  const request = new AbortController();
  activeRequest = request;
  const requestId = ++latestRequestId;

  const params = new URLSearchParams({ page: append ? moreButton.dataset.nextPage : '1' });
  const selectedFilters = append ? appliedFilters : filterParams();
  for (const [key, value] of selectedFilters) {
    params.set(key, value);
  }

  moreButton.disabled = true;
  statusText.classList.remove('form-error');
  statusText.textContent = 'טוען כתבות...';

  try {
    const response = await fetch(`/api/staff/articles?${params}`, {
      signal: request.signal,
      headers: { Accept: 'application/json' }
    });
    const data = await response.json();
    // A newer request started meanwhile: this answer is outdated.
    if (requestId !== latestRequestId) return;
    if (!response.ok) {
      throw new Error(data.error?.message || 'טעינת הכתבות נכשלה');
    }

    if (!append) {
      list.replaceChildren();
      appliedFilters = selectedFilters;
    }
    const cards = data.articles.map((article) => articleCard(article, data.statusLabels));
    list.append(...cards);

    moreButton.dataset.nextPage = data.nextPage || '';
    moreButton.hidden = !data.nextPage;
    statusText.textContent = list.children.length ? '' : 'לא נמצאו כתבות מתאימות.';

    // Save the filters in the address bar (without the page number) without reloading.
    params.delete('page');
    if (filterForm) {
      const queryString = params.size ? `?${params}` : '';
      window.history.replaceState(null, '', `${window.location.pathname}${queryString}`);
    }
  } catch (err) {
    // An outdated or cancelled request is not an error the user needs to see.
    if (requestId !== latestRequestId || err.name === 'AbortError') return;
    statusText.textContent = err.message;
    statusText.classList.add('form-error');
  } finally {
    // Only the newest request may unlock the "more" button.
    if (requestId === latestRequestId) {
      activeRequest = null;
      moreButton.disabled = false;
    }
  }
}

// Applies the current filters right away (and cancels a search that is still waiting).
function refreshArticles() {
  clearTimeout(searchTimer);
  searchTimer = null;
  return loadArticles(false);
}

// ===== Event listeners =============================================================
moreButton.addEventListener('click', () => loadArticles(true));

// Pressing Enter in the form applies the filters immediately.
filterForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  return refreshArticles();
});

filterForm?.elements.status.addEventListener('change', refreshArticles);

filterForm?.elements.q?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  // The old list no longer matches the text: cancel its request and ignore its answer.
  activeRequest?.abort();
  activeRequest = null;
  ++latestRequestId;
  moreButton.disabled = true;
  statusText.classList.remove('form-error');
  statusText.textContent = 'מחפש כתבות...';
  // Debounce: search only after the user stops typing for a moment.
  searchTimer = setTimeout(refreshArticles, SEARCH_DELAY_MS);
});

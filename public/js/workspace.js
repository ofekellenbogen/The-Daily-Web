const list = document.getElementById('workspace-articles');
const more = document.getElementById('workspace-more');
const message = document.getElementById('workspace-status');
const filter = document.getElementById('workspace-filter');
let latestRequest = 0;
let activeRequest = null;
let searchTimer = null;
const SEARCH_DELAY_MS = 350;

function filterParams() {
  const params = new URLSearchParams();
  const status = filter?.elements.status.value;
  const query = filter?.elements.q?.value.trim();
  if (status) params.set('status', status);
  if (query) params.set('q', query);
  return params;
}

let appliedFilters = filterParams();

function articleCard(article, statusLabels) {
  const item = document.createElement('li');
  const card = document.createElement('article');
  card.className = 'staff-card workspace-card';
  card.dataset.workflowStatus = article.workflowStatus;
  const imageUrl = article.imageUrl;
  if (imageUrl) {
    const image = document.createElement('img');
    image.className = 'workspace-card__image';
    image.src = imageUrl;
    image.alt = article.imageAlt || '';
    image.loading = 'lazy';
    card.append(image);
  } else {
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
  if (list.dataset.role === 'editor') details.push(`כתב: ${article.authorId?.displayName || 'משתמש לא זמין'}`);
  if (article.editorNote) details.push(`הערת עורך: ${article.editorNote}`);
  for (const text of details) {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    card.append(paragraph);
  }
  item.append(card);
  return item;
}

async function loadArticles(append) {
  if (append && (activeRequest || searchTimer !== null || !more.dataset.nextPage)) return;
  activeRequest?.abort();
  const request = new AbortController();
  activeRequest = request;
  const requestId = ++latestRequest;
  const params = new URLSearchParams({ page: append ? more.dataset.nextPage : '1' });
  const selectedFilters = append ? appliedFilters : filterParams();
  for (const [key, value] of selectedFilters) params.set(key, value);
  more.disabled = true;
  message.classList.remove('form-error');
  message.textContent = 'טוען כתבות...';
  try {
    const response = await fetch(`/api/staff/articles?${params}`, {
      signal: request.signal, headers: { Accept: 'application/json' }
    });
    const data = await response.json();
    if (requestId !== latestRequest) return;
    if (!response.ok) throw new Error(data.error?.message || 'טעינת הכתבות נכשלה');
    if (!append) {
      list.replaceChildren();
      appliedFilters = selectedFilters;
    }
    list.append(...data.articles.map((article) => articleCard(article, data.statusLabels)));
    more.dataset.nextPage = data.nextPage || '';
    more.hidden = !data.nextPage;
    message.textContent = list.children.length ? '' : 'לא נמצאו כתבות מתאימות.';
    params.delete('page');
    if (filter) window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  } catch (err) {
    if (requestId !== latestRequest || err.name === 'AbortError') return;
    message.textContent = err.message;
    message.classList.add('form-error');
  } finally {
    if (requestId === latestRequest) {
      activeRequest = null;
      more.disabled = false;
    }
  }
}

more.addEventListener('click', () => loadArticles(true));
filter?.addEventListener('submit', (event) => {
  event.preventDefault();
  return refreshArticles();
});
function refreshArticles() {
  clearTimeout(searchTimer);
  searchTimer = null;
  return loadArticles(false);
}

filter?.elements.status.addEventListener('change', refreshArticles);
filter?.elements.q?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  activeRequest?.abort();
  activeRequest = null;
  ++latestRequest;
  more.disabled = true;
  message.classList.remove('form-error');
  message.textContent = 'מחפש כתבות...';
  searchTimer = setTimeout(refreshArticles, SEARCH_DELAY_MS);
});

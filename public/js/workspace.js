const list = document.getElementById('workspace-articles');
const more = document.getElementById('workspace-more');
const message = document.getElementById('workspace-status');
const filter = document.getElementById('workspace-filter');
let latestRequest = 0;

function articleCard(article, statusLabels) {
  const item = document.createElement('li');
  const card = document.createElement('article');
  card.className = `staff-card workspace-card staff-card--${article.workflowStatus}`;
  card.dataset.workflowStatus = article.workflowStatus;
  const imageUrl = article.imageUrl;
  if (imageUrl) {
    const image = document.createElement('img');
    image.className = 'workspace-card__image';
    image.src = imageUrl;
    image.alt = '';
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
  link.textContent = article.workingCopy?.title || 'ללא כותרת';
  heading.append(link);
  card.append(heading);

  const isEditor = list?.dataset?.userRole === 'editor' ||
    (typeof window !== 'undefined' && window.location?.pathname?.startsWith('/editor'));

  const details = [`מצב: ${statusLabels[article.workflowStatus]}`];
  if (isEditor) {
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

async function loadArticles(append) {
  const requestId = ++latestRequest;
  const params = new URLSearchParams({ page: append ? more.dataset.nextPage : '1' });
  if (filter?.elements?.status?.value) {
    params.set('status', filter.elements.status.value);
  }
  more.disabled = true;
  message.classList.remove('form-error');
  message.textContent = 'טוען כתבות...';
  try {
    const response = await fetch(`/api/staff/articles?${params}`);
    const data = await response.json();
    if (requestId !== latestRequest) return;
    if (!response.ok) throw new Error(data.error?.message || 'טעינת הכתבות נכשלה');
    if (!append) list.replaceChildren();
    list.append(...data.articles.map((article) => articleCard(article, data.statusLabels)));
    more.dataset.nextPage = data.nextPage || '';
    more.hidden = !data.nextPage;
    message.textContent = list.children.length ? '' : 'אין כתבות במצב שנבחר.';
    params.delete('page');
    if (filter) window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  } catch (err) {
    if (requestId !== latestRequest) return;
    message.textContent = err.message;
    message.classList.add('form-error');
  } finally {
    if (requestId === latestRequest) more.disabled = false;
  }
}

more.addEventListener('click', () => loadArticles(true));
filter?.addEventListener('submit', (event) => {
  event.preventDefault();
  loadArticles(false);
});
filter?.elements?.status?.addEventListener('change', () => loadArticles(false));

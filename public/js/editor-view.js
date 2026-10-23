(() => {
  'use strict';
  const config = document.currentScript.dataset;
  const editor = document.getElementById('article-editor');
  const input = document.getElementById('article-image');
  const preview = document.getElementById('draft-image-preview');
  const image = preview.querySelector('img');
  const caption = preview.querySelector('figcaption');
  const feedback = document.getElementById('snapshot-status');
  function imageUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  }
  function updatePreview() {
    const url = imageUrl(input.value.trim());
    preview.hidden = !url; image.hidden = false;
    caption.textContent = 'תצוגה מקדימה של תמונת גרסת העבודה';
    if (!url) image.removeAttribute('src');
    else if (image.getAttribute('src') !== url) image.src = url;
  }
  input.addEventListener('input', updatePreview);
  input.addEventListener('change', updatePreview);
  image.addEventListener('error', () => {
    image.hidden = true; caption.textContent = 'לא ניתן לטעון את התמונה. בדקו את הכתובת.';
  });
  image.addEventListener('load', () => { image.hidden = false; });
  // Run after the saving client has restored any locally backed-up form values.
  updatePreview();
  document.addEventListener('DOMContentLoaded', updatePreview, { once: true });

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function renderSnapshot(snapshot) {
    let panel = document.getElementById('approved-snapshot');
    if (!panel) {
      panel = element('section', undefined, 'staff-card approved-snapshot-card');
      panel.id = 'approved-snapshot'; panel.setAttribute('aria-labelledby', 'published-title');
      editor.querySelector('.staff-actions').after(panel);
    }
    const heading = element('h2', 'הגרסה המפורסמת כעת'); heading.id = 'published-title';
    const nodes = [heading, element('p', `גרסה ${snapshot.version} · קטגוריה: ${snapshot.categoryLabel}`),
      element('h3', snapshot.title), element('p', snapshot.summary)];
    const url = imageUrl(snapshot.imageUrl);
    if (url) {
      const picture = element('img', undefined, 'published-image');
      picture.src = url; picture.alt = snapshot.title; nodes.push(picture);
    }
    const body = element('div', undefined, 'approved-snapshot-card__body');
    body.append(element('p', snapshot.body, 'published-body')); nodes.push(body);
    panel.replaceChildren(...nodes);
  }
  let lastStatus = config.initialStatus;
  let requestVersion = 0;
  async function refreshSnapshot() {
    const version = ++requestVersion;
    try {
      const response = await fetch(`/api/staff/articles/${editor.dataset.articleId}/published`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      const result = await response.json();
      if (version !== requestVersion) return;
      if (!response.ok || !result.data) throw new Error();
      renderSnapshot(result.data); feedback.replaceChildren();
    } catch {
      if (version !== requestVersion) return;
      feedback.textContent = 'הפרסום הצליח, אך תצוגת הגרסה המפורסמת לא התרעננה. ';
      const retry = element('button', 'ניסיון נוסף', 'button button--secondary');
      retry.type = 'button'; retry.addEventListener('click', refreshSnapshot); feedback.append(retry);
    }
  }
  if (config.role === 'editor') {
    new MutationObserver(() => {
      const value = editor.dataset.workflowStatus;
      if (value === lastStatus) return;
      lastStatus = value;
      if (value === 'published') void refreshSnapshot();
    }).observe(editor, { attributes: true, attributeFilter: ['data-workflow-status'] });
  }
})();

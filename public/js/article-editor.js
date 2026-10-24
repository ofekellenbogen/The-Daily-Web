// Article editor page (views/staff/article-editor.ejs).
//
// Responsibilities:
//   1. Autosave - every change is sent to the server (PUT /api/staff/articles/:id) without
//      clicking "Save". MongoDB is the real storage, so work survives a refresh, closing the
//      browser, or moving to another computer.
//   2. Local backup - until the server confirms a save, the text is also kept in localStorage,
//      so nothing typed is lost if the network is down. It is retried automatically.
//   3. Workflow buttons - submit / approve / return / delete (saving first, then the action).
//   4. Image preview - shows the image URL typed in the form.
(() => {
  'use strict';

  const editor = document.getElementById('article-editor');
  const form = document.getElementById('article-form');
  const statusText = document.getElementById('staff-status');
  const fieldset = form.querySelector('fieldset');

  const STATUS_LABELS = { draft: 'בהכנה', pending: 'ממתינה לאישור עורך', published: 'פורסמה', returned: 'הוחזרה לתיקונים' };
  const SAVED_MESSAGE = 'כל השינויים נשמרו';
  const EDITABLE_FIELDS = ['title', 'summary', 'body', 'category', 'imageUrl'];
  // Errors where retrying the same content won't help (invalid, logged out, forbidden, locked).
  const PERMANENT_ERRORS = [400, 401, 403, 409];
  const RETRY_INTERVAL_MS = 5000;

  // ===== Local backup (localStorage) ===============================================
  // The key includes the user id, so two accounts on one computer never share a backup.
  const backupKeyFor = (id) => `dailyweb:draft:${editor.dataset.userId}:${id}`;

  let articleId = editor.dataset.articleId; // empty for a brand-new article
  let backupKey = backupKeyFor(articleId || 'new');

  // localStorage can be disabled or full; the backup is optional, so errors are ignored.
  function readBackup() {
    try { return JSON.parse(localStorage.getItem(backupKey)); } catch { return null; }
  }
  function saveBackup(content) {
    try { localStorage.setItem(backupKey, JSON.stringify({ id: articleId, content })); } catch { /* optional */ }
  }
  function removeBackup(key = backupKey) {
    try { localStorage.removeItem(key); } catch { /* optional */ }
  }

  // A new article gets its id in the browser (a random 24-hex-character MongoDB ObjectId).
  // Every autosave then targets the same URL, so a retried request can never create a duplicate.
  function generateObjectId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  const backup = readBackup();
  if (!articleId) articleId = backup?.id || generateObjectId();

  // ===== Save state ================================================================
  let pendingContent = null; // latest form content not yet sent to the server
  let savingPromise = null; // the save loop currently running (only one at a time)
  let actionRunning = false; // a submit/approve/return/delete click is being processed
  let blocked = false; // the server rejected the content; wait for the user to change it
  let changeCounter = 0; // increases on every edit, to detect typing during a save

  function showMessage(text, isError = false) {
    statusText.textContent = text;
    statusText.classList.toggle('form-error', isError);
    statusText.classList.toggle('save-feedback--saved', !isError && text === SAVED_MESSAGE);
  }

  function readForm() {
    return Object.fromEntries(new FormData(form));
  }

  // Updates the status badge, locks the form when needed and shows only the valid buttons.
  function setWorkflow(status) {
    editor.dataset.workflowStatus = status;
    let badge = document.getElementById('article-state');
    if (!badge) {
      badge = document.createElement('p');
      badge.id = 'article-state';
      editor.querySelector('h1').after(badge);
    }
    badge.className = `workflow-badge workflow-badge--${status}`;
    badge.textContent = `מצב: ${STATUS_LABELS[status]}`;

    // A reporter can't edit while the article waits for an editor.
    fieldset.disabled = actionRunning || (editor.dataset.role === 'reporter' && status === 'pending');

    editor.querySelectorAll('[data-action]').forEach((button) => {
      const action = button.dataset.action;
      if (action === 'submit') button.hidden = status === 'pending';
      else if (action === 'approve') button.hidden = status === 'published';
      else if (action === 'return') button.hidden = status !== 'pending';
      else button.hidden = false;
    });
  }

  // fetch() wrapper: sends JSON and throws an Error with the server's Hebrew message on failure.
  async function sendRequest(url, method, body) {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const error = new Error(result?.error?.message || 'השמירה נכשלה');
      error.status = response.status;
      throw error;
    }
    return result;
  }

  // After the very first save, the new article exists on the server:
  // update the URL to /staff/articles/<id> and move the backup to its permanent key.
  function onFirstSave() {
    editor.dataset.articleId = articleId;
    window.history.replaceState(null, '', `/staff/articles/${articleId}`);
    const oldKey = backupKey;
    backupKey = backupKeyFor(articleId);
    if (pendingContent) saveBackup(pendingContent);
    removeBackup(oldKey);
  }

  // Sends pending content to the server, one request at a time. If the user keeps typing
  // during a save, the loop sends the newest content next (never out of order).
  function flushSaves() {
    if (savingPromise) return savingPromise;
    if (!pendingContent || blocked) return Promise.resolve();

    savingPromise = (async () => {
      while (pendingContent && !blocked) {
        const content = pendingContent;
        const changeAtSend = changeCounter;
        pendingContent = null;
        showMessage('שומר אוטומטית…');
        try {
          const result = await sendRequest(`/api/staff/articles/${articleId}`, 'PUT', content);
          setWorkflow(result.workflowStatus);
          if (!editor.dataset.articleId) onFirstSave();
          if (changeCounter === changeAtSend) {
            // Nothing changed while saving: the server has everything, the backup isn't needed.
            removeBackup();
            showMessage(SAVED_MESSAGE);
          } else if (pendingContent) {
            saveBackup(pendingContent);
          }
        } catch (error) {
          // Keep the unsent text (in memory and localStorage) for the next retry.
          pendingContent = pendingContent || content;
          saveBackup(pendingContent);
          blocked = PERMANENT_ERRORS.includes(error.status);
          showMessage(`${error.message}. השינויים ממתינים לשמירה; יש להישאר בעמוד עד אישור שמירה.`, true);
          throw error;
        }
      }
    })().finally(() => { savingPromise = null; });

    return savingPromise;
  }

  // Called on every keystroke / change in the form.
  function queueSave() {
    if (fieldset.disabled || actionRunning) return;
    changeCounter += 1;
    pendingContent = readForm();
    saveBackup(pendingContent);
    blocked = false; // new content may fix whatever the server rejected
    flushSaves().catch(() => {}); // the error is already shown by flushSaves
  }

  // ===== Workflow buttons ==========================================================

  async function runAction(action) {
    if (actionRunning) return;
    if (action === 'delete' && !window.confirm('למחוק את הכתבה?')) return;
    const note = document.getElementById('editor-note')?.value || '';
    if (action === 'return' && !note.trim()) return showMessage('יש לצרף הערה לתיקונים', true);

    actionRunning = true;
    const buttons = [...editor.querySelectorAll('button')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      // Save the current form first, so the action applies to exactly what is on screen.
      if (action !== 'delete') {
        changeCounter += 1;
        pendingContent = readForm();
        saveBackup(pendingContent);
        blocked = false;
        fieldset.disabled = true;
        await flushSaves();
      }

      if (action === 'delete') {
        await sendRequest(`/api/staff/articles/${articleId}`, 'DELETE');
        return window.location.assign('/editor');
      }
      await sendRequest(`/api/staff/articles/${articleId}/${action}`, 'POST', action === 'return' ? { note } : undefined);

      const nextStatus = { submit: 'pending', approve: 'published', return: 'returned' }[action];
      setWorkflow(nextStatus);
      showMessage('הפעולה הושלמה');
      // Reload after publishing so the "currently published version" panel shows the new version.
      if (action === 'approve') window.location.reload();
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      actionRunning = false;
      setWorkflow(editor.dataset.workflowStatus);
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  // ===== Image preview =============================================================

  const imageInput = document.getElementById('article-image');
  const preview = document.getElementById('draft-image-preview');

  // Only http(s) URLs and our generated /article-images/... are previewed ("javascript:" is not).
  function safeImageUrl(value) {
    if (/^\/article-images\/[0-9a-f]{24}\.svg$/i.test(value)) return value;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function updatePreview() {
    if (!imageInput || !preview) return;
    const image = preview.querySelector('img');
    const caption = preview.querySelector('figcaption');
    const url = safeImageUrl(imageInput.value.trim());
    preview.hidden = !url;
    image.hidden = false;
    caption.textContent = 'תצוגה מקדימה של תמונת גרסת העבודה';
    if (!url) image.removeAttribute('src');
    else if (image.getAttribute('src') !== url) image.src = url;
  }

  if (imageInput && preview) {
    const image = preview.querySelector('img');
    imageInput.addEventListener('input', updatePreview);
    image.addEventListener('error', () => {
      image.hidden = true;
      preview.querySelector('figcaption').textContent = 'לא ניתן לטעון את התמונה. בדקו את הכתובת.';
    });
    image.addEventListener('load', () => { image.hidden = false; });
  }

  // ===== Start =====================================================================

  form.addEventListener('input', queueSave);
  form.addEventListener('change', queueSave);
  // Keep implicit form submission on the page and use the same autosave path.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    queueSave();
  });

  // Restore text that was typed but never reached the server (e.g. network was down).
  if (backup?.content && !fieldset.disabled) {
    for (const name of EDITABLE_FIELDS) {
      if (typeof backup.content[name] === 'string') form.elements[name].value = backup.content[name];
    }
    queueSave();
  }
  updatePreview();

  editor.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => runAction(button.dataset.action));
  });
  setWorkflow(editor.dataset.workflowStatus);

  // Retry unsent changes when the network returns, and every few seconds.
  window.addEventListener('online', () => { flushSaves().catch(() => {}); });
  window.setInterval(() => {
    if (pendingContent && !actionRunning) flushSaves().catch(() => {});
  }, RETRY_INTERVAL_MS);

  // Warn before leaving the page while something is not saved yet.
  window.addEventListener('beforeunload', (event) => {
    if (pendingContent || savingPromise) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
})();

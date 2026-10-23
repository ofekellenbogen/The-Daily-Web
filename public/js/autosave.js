(() => {
  'use strict';
  const editor = document.getElementById('article-editor');
  const context = document.getElementById('draft-context');
  if (context) Object.assign(editor.dataset, context.dataset);
  const form = document.getElementById('article-form');
  const status = document.getElementById('staff-status');
  const fieldset = form.querySelector('fieldset');
  const labels = { draft: 'בהכנה', pending: 'ממתינה לאישור עורך', published: 'פורסמה', returned: 'הוחזרה לתיקונים' };
  let id = editor.dataset.articleId;
  let key = `dailyweb:draft:${editor.dataset.userId}:${id || 'new'}`;
  let pending = null, saving = null, busy = false, blocked = false, generation = 0;
  let backup;
  try { backup = JSON.parse(localStorage.getItem(key)); } catch { /* Optional browser backup. */ }
  if (!id) id = backup?.id || Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  function message(text, error = false) {
    status.textContent = text; status.classList.toggle('form-error', error);
    status.classList.toggle('save-feedback--saved', !error && text === 'כל השינויים נשמרו');
  }
  function remember(content) {
    try { localStorage.setItem(key, JSON.stringify({ id, content })); } catch { /* Server is primary storage. */ }
  }
  function setWorkflow(value) {
    editor.dataset.workflowStatus = value;
    let badge = document.getElementById('article-state');
    if (!badge) {
      badge = document.createElement('p'); badge.id = 'article-state'; editor.querySelector('h1').after(badge);
    }
    badge.className = `workflow-badge workflow-badge--${value}`; badge.textContent = `מצב: ${labels[value]}`;
    fieldset.disabled = busy || (editor.dataset.role === 'reporter' && value === 'pending');
    editor.querySelectorAll('[data-action]').forEach(button => {
      const action = button.dataset.action;
      button.hidden = action === 'submit' ? value === 'pending' : ['approve', 'return'].includes(action) && value !== 'pending';
    });
  }
  async function request(url, method, body) {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const error = new Error(result?.error?.message || 'השמירה נכשלה'); error.status = response.status; throw error;
    }
    return result;
  }
  function flush() {
    if (saving) return saving;
    if (!pending || blocked) return Promise.resolve();
    saving = (async () => {
      while (pending && !blocked) {
        const content = pending, sentGeneration = generation; pending = null;
        message('שומר אוטומטית…');
        try {
          const result = await request(`/api/staff/drafts/${id}`, 'PUT', content);
          setWorkflow(result.workflowStatus);
          if (!editor.dataset.articleId) {
            editor.dataset.articleId = id; window.history.replaceState(null, '', `/staff/articles/${id}`);
            const oldKey = key;
            key = `dailyweb:draft:${editor.dataset.userId}:${id}`;
            if (pending) remember(pending);
            try { localStorage.removeItem(oldKey); } catch { /* Optional backup. */ }
          }
          if (generation === sentGeneration) {
            try { localStorage.removeItem(key); } catch { /* Optional backup. */ }
            key = `dailyweb:draft:${editor.dataset.userId}:${id}`; message('כל השינויים נשמרו');
          } else if (pending) remember(pending);
        } catch (error) {
          pending = pending || content; remember(pending);
          blocked = [400, 401, 403, 409].includes(error.status);
          message(`${error.message}. השינויים ממתינים לשמירה; יש להישאר בעמוד עד אישור שמירה.`, true); throw error;
        }
      }
    })().finally(() => { saving = null; });
    return saving;
  }
  function queue() {
    if (fieldset.disabled || busy) return;
    generation++; pending = Object.fromEntries(new FormData(form)); remember(pending); blocked = false;
    void flush().catch(() => {});
  }
  form.addEventListener('input', queue); form.addEventListener('change', queue);
  form.addEventListener('submit', event => { event.preventDefault(); queue(); });
  if (!editor.querySelector('[data-action="submit"]') && editor.dataset.role === 'reporter') {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button';
    button.dataset.action = 'submit'; button.textContent = 'שליחה לאישור עורך'; form.after(button);
  }
  if (backup?.content && !fieldset.disabled) {
    for (const name of ['title', 'summary', 'body', 'category', 'imageUrl']) {
      if (typeof backup.content[name] === 'string') form.elements[name].value = backup.content[name];
    }
    queue();
  }
  editor.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
    if (busy) return;
    const action = button.dataset.action;
    if (action === 'delete' && !window.confirm('למחוק את הכתבה?')) return;
    const note = document.getElementById('editor-note')?.value || '';
    if (action === 'return' && !note.trim()) return message('יש לצרף הערה לתיקונים', true);
    busy = true; const buttons = [...editor.querySelectorAll('button')]; buttons.forEach(b => { b.disabled = true; });
    try {
      if (action !== 'delete') {
        pending = Object.fromEntries(new FormData(form)); generation++; remember(pending); blocked = false;
        fieldset.disabled = true;
        await flush();
      }
      await request(`/api/staff/articles/${id}${action === 'delete' ? '' : `/${action}`}`,
        action === 'delete' ? 'DELETE' : 'POST', action === 'return' ? { note } : undefined);
      if (action === 'delete') return window.location.assign('/editor');
      setWorkflow({ submit: 'pending', approve: 'published', return: 'returned' }[action]); message('הפעולה הושלמה');
    } catch (error) { message(error.message, true); }
    finally { busy = false; setWorkflow(editor.dataset.workflowStatus); buttons.forEach(b => { b.disabled = false; }); }
  }));
  setWorkflow(editor.dataset.workflowStatus);
  window.addEventListener('online', () => { void flush().catch(() => {}); });
  window.setInterval(() => { if (pending && !busy) void flush().catch(() => {}); }, 5000);
  window.addEventListener('beforeunload', event => {
    if (pending || saving) { event.preventDefault(); event.returnValue = ''; }
  });
})();

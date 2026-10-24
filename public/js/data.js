(() => {
  const $ = id => document.getElementById(id);
  const resource = $('data-resource'), form = $('data-form'), fields = $('data-fields'), status = $('data-status');
  const configs = {
    users: [['username', 'שם משתמש', 'text'], ['displayName', 'שם לתצוגה', 'text'], ['role', 'תפקיד', 'role'], ['password', 'סיסמה (בעריכה: השאר ריק לשמירת הסיסמה)', 'password']],
    comments: [['articleId', 'מזהה כתבה', 'text'], ['authorName', 'שם המגיב', 'text'], ['body', 'תוכן התגובה', 'textarea']],
    stats: [['articleId', 'מזהה כתבה', 'text'], ['dayUtc', 'תאריך (UTC)', 'date'], ['time', 'שעה (UTC, מקטע של 5 דקות)', 'time'], ['count', 'צפיות במקטע הזמן', 'number']]
  };
  let editing = null, nextPage = null, version = 0, busy = false;
  async function api(path, method = 'GET', body) {
    const response = await fetch(`/api/admin/${resource.value}${path}`, { method,
      headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(result?.error?.message || 'הפעולה נכשלה');
    return result;
  }
  async function run(fn) {
    if (busy) return;
    busy = true; status.textContent = 'טוען…';
    document.querySelectorAll('main button, #data-resource').forEach(el => { el.disabled = true; });
    try { await fn(); status.textContent = 'הפעולה הושלמה'; }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; document.querySelectorAll('main button, #data-resource').forEach(el => { el.disabled = false; }); }
  }
  function open(row = {}) {
    editing = row._id || null; fields.replaceChildren(); form.hidden = false;
    $('data-form-title').textContent = editing ? 'עריכת רשומה' : 'רשומה חדשה';
    for (const [name, labelText, type] of configs[resource.value]) {
      if (editing && ['articleId', 'dayUtc'].includes(name)) continue;
      const label = document.createElement('label'); label.htmlFor = `field-${name}`; label.textContent = labelText;
      const input = document.createElement(type === 'textarea' ? 'textarea' : type === 'role' ? 'select' : 'input');
      input.id = `field-${name}`; input.name = name;
      if (type === 'role') {
        for (const [value, text] of [['reporter', 'כתב'], ['editor', 'עורך']]) {
          const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
        }
      } else if (type !== 'textarea') input.type = type;
      input.required = name !== 'authorName' && !(name === 'password' && editing);
      input.maxLength = name === 'body' ? 1000 : name === 'password' ? 256 : 100;
      if (type === 'password') input.minLength = 8;
      if (type === 'number') { input.min = 0; input.max = 1000000000; input.step = 1; }
      if (type === 'time') input.step = 300;
      input.value = row[name] || (name === 'role' ? 'reporter' : name === 'time' ? '00:00' : name === 'count' ? (row.buckets?.['0'] || 0) : '');
      fields.append(label, input);
    }
    // Select a time to inspect or change its current bucket count.
    if (resource.value === 'stats' && editing) form.elements.time.addEventListener('change', () => {
      const [h, m] = form.elements.time.value.split(':').map(Number);
      form.elements.count.value = row.buckets?.[h * 12 + m / 5] || 0;
    });
    fields.querySelector('input, select, textarea')?.focus();
  }
  async function load(append = false) {
    const current = ++version;
    const result = await api(`?${new URLSearchParams({ page: append ? nextPage : 1, q: $('data-query').value })}`);
    if (current !== version) return;
    if (!append) $('data-list').replaceChildren();
    for (const row of result.data) {
      const li = document.createElement('li'), card = document.createElement('article'); card.className = 'staff-card';
      const heading = document.createElement('h2'); heading.textContent = row.displayName || row.authorName || new Date(row.dayUtc).toLocaleDateString('he-IL', { timeZone: 'UTC' });
      const detail = document.createElement('p'); detail.textContent = resource.value === 'users' ? `${row.username} · ${row.role === 'editor' ? 'עורך' : 'כתב'}` : resource.value === 'comments' ? row.body : `סה״כ ${row.total} צפיות`;
      const identifier = document.createElement('p'); identifier.textContent = `מזהה: ${row._id}${row.articleId ? ` · כתבה: ${row.articleId}` : ''}`; identifier.style.overflowWrap = 'anywhere';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button'; edit.textContent = 'עריכה'; edit.onclick = () => open(row);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button--secondary'; remove.textContent = 'מחיקה';
      remove.onclick = () => { if (confirm('למחוק את הרשומה?')) void run(async () => { await api(`/${row._id}`, 'DELETE'); await load(); }); };
      const actions = document.createElement('div'); actions.className = 'staff-actions'; actions.append(edit, remove);
      card.append(heading, detail, identifier, actions); li.append(card); $('data-list').append(li);
    }
    nextPage = result.nextPage; $('data-more').hidden = !nextPage;
    if (!result.data.length && !append) status.textContent = 'לא נמצאו רשומות';
  }
  resource.addEventListener('change', () => { form.hidden = true; $('data-query').value = ''; void run(() => load()); });
  $('data-search').onsubmit = event => { event.preventDefault(); void run(() => load()); };
  $('data-more').onclick = () => { void run(() => load(true)); };
  $('data-new').onclick = () => open(); $('data-cancel').onclick = () => { form.hidden = true; };
  form.onsubmit = event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (resource.value === 'stats') {
      const [h, m] = body.time.split(':').map(Number); body.slot = h * 12 + m / 5; delete body.time; body.count = Number(body.count);
    }
    void run(async () => { await api(editing ? `/${editing}` : '', editing ? 'PATCH' : 'POST', body); form.hidden = true; await load(); });
  };
  void run(() => load());
})();

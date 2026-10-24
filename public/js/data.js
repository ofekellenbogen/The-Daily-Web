(() => {
  const $ = id => document.getElementById(id);
  const form = $('data-form'), fields = $('data-fields'), status = $('data-status');
  const userFields = [['username', 'שם משתמש', 'text'], ['displayName', 'שם לתצוגה', 'text'], ['role', 'תפקיד', 'role'], ['password', 'סיסמה (בעריכה: השאר ריק לשמירת הסיסמה)', 'password']];
  let editing = null, nextPage = null, version = 0, busy = false;
  async function api(path, method = 'GET', body) {
    const response = await fetch(`/api/admin/users${path}`, { method,
      headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(result?.error?.message || 'הפעולה נכשלה');
    return result;
  }
  async function run(fn) {
    if (busy) return;
    busy = true; status.textContent = 'טוען…';
    document.querySelectorAll('main button').forEach(el => { el.disabled = true; });
    try { await fn(); if (status.textContent === 'טוען…') status.textContent = 'הפעולה הושלמה'; }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; document.querySelectorAll('main button').forEach(el => { el.disabled = false; }); }
  }
  function open(row = {}) {
    editing = row._id || null; fields.replaceChildren(); form.hidden = false;
    $('data-form-title').textContent = editing ? 'עריכת משתמש' : 'משתמש חדש';
    for (const [name, labelText, type] of userFields) {
      const label = document.createElement('label'); label.htmlFor = `field-${name}`; label.textContent = labelText;
      const input = document.createElement(type === 'role' ? 'select' : 'input');
      input.id = `field-${name}`; input.name = name;
      if (type === 'role') {
        for (const [value, text] of [['reporter', 'כתב'], ['editor', 'עורך']]) {
          const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
        }
      } else input.type = type;
      input.required = !(name === 'password' && editing);
      input.maxLength = name === 'password' ? 256 : 100;
      if (type === 'password') input.minLength = 8;
      input.value = row[name] || (name === 'role' ? 'reporter' : '');
      fields.append(label, input);
    }
    fields.querySelector('input, select, textarea')?.focus();
  }
  async function load(append = false) {
    const current = ++version;
    const result = await api(`?${new URLSearchParams({ page: append ? nextPage : 1, q: $('data-query').value })}`);
    if (current !== version) return;
    if (!append) $('data-list').replaceChildren();
    for (const row of result.data) {
      const li = document.createElement('li'), card = document.createElement('article'); card.className = 'staff-card';
      const heading = document.createElement('h2'); heading.textContent = row.displayName;
      const detail = document.createElement('p'); detail.textContent = `${row.username} · ${row.role === 'editor' ? 'עורך' : 'כתב'}`;
      const identifier = document.createElement('p'); identifier.textContent = `מזהה: ${row._id}`; identifier.style.overflowWrap = 'anywhere';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button'; edit.textContent = 'עריכה'; edit.onclick = () => open(row);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button--secondary'; remove.textContent = 'מחיקה';
      remove.onclick = () => { if (confirm('למחוק את המשתמש?')) void run(async () => { await api(`/${row._id}`, 'DELETE'); form.hidden = true; await load(); }); };
      const actions = document.createElement('div'); actions.className = 'staff-actions'; actions.append(edit, remove);
      card.append(heading, detail, identifier, actions); li.append(card); $('data-list').append(li);
    }
    nextPage = result.nextPage; $('data-more').hidden = !nextPage;
    if (!result.data.length && !append) status.textContent = 'לא נמצאו משתמשים';
  }
  $('data-search').onsubmit = event => { event.preventDefault(); void run(() => load()); };
  $('data-more').onclick = () => { void run(() => load(true)); };
  $('data-new').onclick = () => open(); $('data-cancel').onclick = () => { form.hidden = true; };
  form.onsubmit = event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    void run(async () => { await api(editing ? `/${editing}` : '', editing ? 'PATCH' : 'POST', body); form.hidden = true; await load(); });
  };
  void run(() => load());
})();

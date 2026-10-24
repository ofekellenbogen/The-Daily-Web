// User management page for admins (views/staff/users.ejs).
//
// Responsibilities:
//   1. List - searches staff users and shows them as cards, page by page
//      (GET /api/admin/users?page=...&q=...).
//   2. Create / edit - one form is built in the browser and used for both
//      (POST /api/admin/users, PATCH /api/admin/users/:id).
//   3. Delete - after a confirmation (DELETE /api/admin/users/:id).
//
// Every action runs through run(), which locks all buttons until it finishes,
// so the admin can't start two actions at the same time.
(() => {
  // ===== Page elements and state ===================================================
  const byId = (id) => document.getElementById(id);
  const form = byId('data-form');
  const fields = byId('data-fields');
  const statusText = byId('data-status');

  // The form fields: [field name, Hebrew label, input type].
  // 'role' is a special type that becomes a <select> instead of an <input>.
  const userFields = [
    ['username', 'שם משתמש', 'text'],
    ['displayName', 'שם לתצוגה', 'text'],
    ['role', 'תפקיד', 'role'],
    ['password', 'סיסמה (בעריכה: השאר ריק לשמירת הסיסמה)', 'password']
  ];
  const ROLE_OPTIONS = [['reporter', 'כתב'], ['editor', 'עורך']];
  const LOADING_MESSAGE = 'טוען…';

  let editingId = null; // id of the user being edited, null when creating a new user
  let nextPage = null; // next page number from the server (null = no more pages)
  let listVersion = 0; // increases on every load; older answers are ignored
  let busy = false; // an action is running

  // ===== Server requests ===========================================================
  // fetch() wrapper: sends JSON and throws an Error with the server's Hebrew message on failure.
  async function api(path, method = 'GET', body) {
    const response = await fetch(`/api/admin/users${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    // 204 = "No Content" (a successful delete), so there is no JSON to read.
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      throw new Error(result?.error?.message || 'הפעולה נכשלה');
    }
    return result;
  }

  function setButtonsDisabled(disabled) {
    document.querySelectorAll('main button').forEach((button) => {
      button.disabled = disabled;
    });
  }

  // Runs one action at a time: shows "loading", disables all buttons and reports the result.
  async function run(action) {
    if (busy) return;
    busy = true;
    statusText.textContent = LOADING_MESSAGE;
    setButtonsDisabled(true);
    try {
      await action();
      // Show "done" only if the action didn't write its own message.
      if (statusText.textContent === LOADING_MESSAGE) {
        statusText.textContent = 'הפעולה הושלמה';
      }
    } catch (error) {
      statusText.textContent = error.message;
    } finally {
      busy = false;
      setButtonsDisabled(false);
    }
  }

  // ===== Create / edit form ========================================================
  // Opens the form empty (new user) or filled with an existing user's data (edit).
  function openForm(user = {}) {
    editingId = user._id || null;
    fields.replaceChildren();
    form.hidden = false;
    byId('data-form-title').textContent = editingId ? 'עריכת משתמש' : 'משתמש חדש';

    for (const [name, labelText, type] of userFields) {
      const label = document.createElement('label');
      label.htmlFor = `field-${name}`;
      label.textContent = labelText;

      const input = document.createElement(type === 'role' ? 'select' : 'input');
      input.id = `field-${name}`;
      input.name = name;
      if (type === 'role') {
        for (const [value, text] of ROLE_OPTIONS) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = text;
          input.append(option);
        }
      } else {
        input.type = type;
      }

      // When editing, an empty password means "keep the current password".
      input.required = !(name === 'password' && editingId);
      input.maxLength = name === 'password' ? 256 : 100;
      if (type === 'password') input.minLength = 8;
      // Fill in the user's current value; a new user starts with the "reporter" role.
      input.value = user[name] || (name === 'role' ? 'reporter' : '');
      fields.append(label, input);
    }

    fields.querySelector('input, select, textarea')?.focus();
  }

  // ===== User list =================================================================
  function createButton(className, text, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    button.onclick = onClick;
    return button;
  }

  function deleteUser(user) {
    if (!confirm('למחוק את המשתמש?')) return;
    void run(async () => {
      await api(`/${user._id}`, 'DELETE');
      form.hidden = true;
      await loadUsers();
    });
  }

  function userCard(user) {
    const item = document.createElement('li');
    const card = document.createElement('article');
    card.className = 'staff-card';

    const heading = document.createElement('h2');
    heading.textContent = user.displayName;
    const detail = document.createElement('p');
    detail.textContent = `${user.username} · ${user.role === 'editor' ? 'עורך' : 'כתב'}`;

    const editButton = createButton('button', 'עריכה', () => openForm(user));
    const deleteButton = createButton('button button--secondary', 'מחיקה', () => deleteUser(user));
    const actions = document.createElement('div');
    actions.className = 'staff-actions';
    actions.append(editButton, deleteButton);

    card.append(heading, detail, actions);
    item.append(card);
    return item;
  }

  // append = true adds the next page; otherwise the list is replaced with page 1.
  async function loadUsers(append = false) {
    const currentVersion = ++listVersion;
    const params = new URLSearchParams({
      page: append ? nextPage : 1,
      q: byId('data-query').value
    });
    const result = await api(`?${params}`);
    // A newer load started meanwhile: this answer is outdated.
    if (currentVersion !== listVersion) return;

    const list = byId('data-list');
    if (!append) list.replaceChildren();
    for (const user of result.data) {
      list.append(userCard(user));
    }

    nextPage = result.nextPage;
    byId('data-more').hidden = !nextPage;
    if (!result.data.length && !append) {
      statusText.textContent = 'לא נמצאו משתמשים';
    }
  }

  // ===== Event handlers ============================================================
  // "void" marks that the returned promise is intentionally not awaited.
  byId('data-search').onsubmit = (event) => {
    event.preventDefault();
    void run(() => loadUsers());
  };

  byId('data-more').onclick = () => {
    void run(() => loadUsers(true));
  };

  byId('data-new').onclick = () => openForm();

  byId('data-cancel').onclick = () => {
    form.hidden = true;
  };

  form.onsubmit = (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    // Existing user -> PATCH /:id, new user -> POST.
    const path = editingId ? `/${editingId}` : '';
    const method = editingId ? 'PATCH' : 'POST';
    void run(async () => {
      await api(path, method, body);
      form.hidden = true;
      await loadUsers();
    });
  };

  // First page of users.
  void run(() => loadUsers());
})();

const editor = document.getElementById('article-editor');
const form = document.getElementById('article-form');
const status = document.getElementById('staff-status');
const articleId = editor.dataset.articleId;

async function request(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'הפעולה נכשלה');
  return data;
}

async function save() {
  if (!form.reportValidity()) throw new Error('יש לבדוק את שדות הטופס');
  const content = Object.fromEntries(new FormData(form));
  return request(`/api/staff/articles${articleId ? `/${articleId}` : ''}`, articleId ? 'PATCH' : 'POST', content);
}

const liveWorkflow = {
  save: { status: 'draft', label: 'בהכנה' },
  submit: { status: 'pending', label: 'ממתינה לאישור עורך' },
  approve: { status: 'published', label: 'פורסמה' },
  return: { status: 'returned', label: 'הוחזרה לתיקונים' }
};

function updateWorkflowState(action, result) {
  const next = liveWorkflow[action];
  if (!next) return;
  const state = document.getElementById('article-state');
  if (!state) return;
  const workflowStatus = result?.workflowStatus || next.status;
  const statusLabel = result?.statusLabel || next.label;
  state.className = `workflow-badge workflow-badge--${workflowStatus}`;
  state.replaceChildren();
  const dot = document.createElement('span');
  dot.setAttribute('aria-hidden', 'true');
  const text = document.createElement('strong');
  text.textContent = `מצב: ${statusLabel}`;
  state.append(dot, text);
  editor.dataset.workflowStatus = workflowStatus;
}

// Keep one request sequence active, so repeated clicks cannot duplicate publication.
async function run(action) {
  const buttons = [...editor.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; });
  status.textContent = 'שומר...';
  status.classList.remove('form-error');
  try {
    await action();
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('form-error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  run(async () => {
    const result = await save();
    if (!articleId) return window.location.assign(`/staff/articles/${result.id}`);
    updateWorkflowState('save', { workflowStatus: 'draft', statusLabel: result.statusLabel });
    status.textContent = result.message;
  });
});

editor.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'delete' && !window.confirm('למחוק את הכתבה?')) return;
    const note = document.getElementById('editor-note')?.value || '';
    if (action === 'return' && !note.trim()) {
      status.textContent = 'יש לצרף הערה לתיקונים';
      status.classList.add('form-error');
      return;
    }
    run(async () => {
      if (action !== 'delete') await save();
      const result = await request(`/api/staff/articles/${articleId}${action === 'delete' ? '' : `/${action}`}`,
        action === 'delete' ? 'DELETE' : 'POST', action === 'return' ? { note } : undefined);
      if (action === 'delete') window.location.assign('/editor');
      else {
        updateWorkflowState(action, result);
        button.hidden = true;
        if (action === 'approve' || action === 'return') {
          editor.querySelectorAll('[data-action="approve"], [data-action="return"]').forEach((reviewButton) => {
            reviewButton.hidden = true;
          });
        }
        status.textContent = result?.message || 'הסטטוס עודכן';
      }
    });
  });
});

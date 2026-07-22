const SECRET_KEY = 'esbAdminSecret';

const GROUP_LABELS = {
  because: 'Because 服务地址',
  auth: '登录凭证',
  agent: 'Agent 路由',
  timeout: '超时',
  stream: '流式任务',
  log: '日志',
  parse: '文本解析',
  misc: '其它',
};

/** 默认展开的分组；其余折叠 */
const EXPANDED_GROUPS = new Set(['because', 'auth', 'agent']);

const formEl = document.getElementById('configForm');
const toastEl = document.getElementById('toast');
const authBadge = document.getElementById('authBadge');
const runtimePathEl = document.getElementById('runtimePath');
const secretDialog = document.getElementById('secretDialog');
const secretInput = document.getElementById('secretInput');

let toastTimer = null;

function getSecret() {
  return localStorage.getItem(SECRET_KEY) || '';
}

function setSecret(v) {
  if (v) localStorage.setItem(SECRET_KEY, v);
  else localStorage.removeItem(SECRET_KEY);
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  const secret = getSecret();
  if (secret) h['X-Esb-Admin-Secret'] = secret;
  return h;
}

function showStatus(msg, ok) {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastEl.hidden = false;
  toastEl.textContent = msg;
  toastEl.className = `toast show ${ok ? 'ok' : 'err'}`;
  // 错误多留一会儿，方便阅读
  const ms = ok ? 2800 : 4500;
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
      toastTimer = null;
    }, 220);
  }, ms);
}

async function api(path, options = {}) {
  const res = await fetch(`/api/admin${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function createSecretInput(field, value) {
  const wrap = document.createElement('div');
  wrap.className = 'secret-wrap';

  const input = document.createElement('input');
  input.id = field.key;
  input.name = field.key;
  input.type = 'password';
  input.value = value ?? '';
  input.autocomplete = 'new-password';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'secret-toggle';
  toggle.setAttribute('aria-label', '显示密码');
  toggle.textContent = '显示';
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? '隐藏' : '显示';
    toggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
  });

  wrap.append(input, toggle);
  return wrap;
}

function renderForm(payload) {
  const { fields, values, overridden } = payload;
  const overriddenSet = new Set(overridden || []);
  const groups = {};
  for (const field of fields) {
    if (!groups[field.group]) groups[field.group] = [];
    groups[field.group].push(field);
  }

  formEl.innerHTML = '';
  for (const [group, list] of Object.entries(groups)) {
    const section = document.createElement('section');
    section.className = 'group';

    const details = document.createElement('details');
    details.className = 'group-details';
    if (EXPANDED_GROUPS.has(group)) details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'group-title';
    summary.textContent = GROUP_LABELS[group] || group;
    details.append(summary);

    for (const field of list) {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const meta = document.createElement('div');
      meta.className = 'field-meta';
      meta.innerHTML = `<span>${field.label}</span><span class="badge">${field.env}</span>`;
      if (overriddenSet.has(field.key)) {
        meta.innerHTML +=
          '<span class="badge overridden" title="已写入 runtime-config.json，优先于 .env；点「恢复环境变量默认」可清除">已覆盖</span>';
      }

      const help = document.createElement('p');
      help.className = 'help';
      help.textContent = field.help || '';

      if (field.type === 'boolean') {
        const row = document.createElement('div');
        row.className = 'bool-row';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = field.key;
        input.name = field.key;
        input.checked = !!values[field.key];
        const lab = document.createElement('label');
        lab.htmlFor = field.key;
        lab.append(input, document.createTextNode(' 启用'));
        row.append(lab);
        wrap.append(meta, help, row);
      } else if (field.type === 'secret') {
        wrap.append(meta, help, createSecretInput(field, values[field.key]));
      } else {
        const input = document.createElement('input');
        input.id = field.key;
        input.name = field.key;
        if (field.type === 'number') {
          input.type = 'number';
          input.min = '0';
          input.step = '1';
          input.value = values[field.key] ?? '';
        } else {
          input.type = 'text';
          input.value = values[field.key] ?? '';
        }
        wrap.append(meta, help, input);
      }
      details.append(wrap);
    }
    section.append(details);
    formEl.append(section);
  }

  runtimePathEl.textContent = payload.runtimeConfigPath || 'data/runtime-config.json';
  authBadge.textContent = payload.authRequired ? '鉴权：已启用' : '鉴权：未启用';
  authBadge.className = payload.authRequired ? 'badge warn' : 'badge';
}

function collectPatch(fields) {
  const patch = {};
  for (const field of fields) {
    const el = document.getElementById(field.key);
    if (!el) continue;
    if (field.type === 'boolean') {
      patch[field.key] = el.checked;
    } else if (field.type === 'secret') {
      if (el.value) patch[field.key] = el.value;
    } else if (field.type === 'number') {
      patch[field.key] = Number(el.value);
    } else {
      patch[field.key] = el.value;
    }
  }
  return patch;
}

let currentFields = [];
let loadSeq = 0;

async function loadConfig({ quiet } = {}) {
  const btn = document.getElementById('btnReload');
  const seq = ++loadSeq;
  if (btn) {
    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = '加载中…';
  }
  formEl.classList.add('is-reloading');
  try {
    const data = await api('/config');
    if (seq !== loadSeq) return;
    currentFields = data.fields || [];
    renderForm(data);
    const n = (data.overridden || []).length;
    if (!quiet) {
      showStatus(
        n > 0
          ? `已重新加载（${n} 项热更新覆盖仍在；要清掉请点「恢复环境变量默认」）`
          : '已重新加载（当前均为环境变量默认，无覆盖）',
        true,
      );
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.textContent = '重新加载';
    }
    formEl.classList.remove('is-reloading');
  }
}

document.getElementById('btnReload').addEventListener('click', () => {
  loadConfig().catch((err) => showStatus(err.message, false));
});

document.getElementById('btnSecret').addEventListener('click', () => {
  secretInput.value = getSecret();
  secretDialog.showModal();
});

document.getElementById('secretForm').addEventListener('close', () => {
  if (secretDialog.returnValue === 'ok') {
    setSecret(secretInput.value.trim());
    loadConfig().catch((err) => showStatus(err.message, false));
  }
});

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const patch = collectPatch(currentFields);
    const data = await api('/config', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    currentFields = data.fields || currentFields;
    renderForm(data);
    showStatus('已保存并热更新，新请求立即生效', true);
  } catch (err) {
    showStatus(err.message, false);
  }
});

document.getElementById('btnReset').addEventListener('click', async () => {
  if (!confirm('确认清除运行时覆盖层，恢复为容器环境变量？')) return;
  try {
    const data = await api('/config/reset', { method: 'POST', body: '{}' });
    currentFields = data.fields || currentFields;
    renderForm(data);
    showStatus('已恢复环境变量默认值', true);
  } catch (err) {
    showStatus(err.message, false);
  }
});

loadConfig({ quiet: true }).catch((err) => {
  showStatus(err.message, false);
  if (err.status === 401) secretDialog.showModal();
});

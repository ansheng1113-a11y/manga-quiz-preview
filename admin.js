const $ = id => document.getElementById(id);
const sessionKey = 'manga-delivery.admin-session';
let config, session, selectedBatch;
$('login-form').addEventListener('submit', event => event.preventDefault());

function status(message = '', error = false) {
  $('status').textContent = message;
  $('status').dataset.error = String(error);
}
function saveSession(value) {
  session = value;
  try {
    if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
    else sessionStorage.removeItem(sessionKey);
  } catch { /* The login remains usable in this tab. */ }
}
function showLogin() {
  $('login-section').hidden = false;
  $('dashboard').hidden = true;
  $('password').value = '';
}
function showDashboard() {
  $('login-section').hidden = true;
  $('dashboard').hidden = false;
  $('account').textContent = session?.user?.email || '已登录管理员';
}
function localTime(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '';
}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function action(label, callback) {
  const button = node('button', label, 'secondary');
  button.type = 'button';
  button.addEventListener('click', () => busy(button, callback));
  return button;
}
async function busy(button, callback) {
  button.disabled = true;
  try { await callback(); }
  catch (error) { status(error.message, true); }
  finally { button.disabled = false; }
}
async function authRequest(grant, body) {
  const response = await fetch(`${config.authUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publishableKey },
    body: JSON.stringify(body), cache: 'no-store'
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.msg || value.error_description || '登录失败，请检查邮箱和密码。');
  return { ...value, expires_at: value.expires_at || Math.floor(Date.now() / 1000) + value.expires_in };
}
async function token() {
  if (!session) throw new Error('请先登录管理员账号。');
  if (session.expires_at * 1000 <= Date.now() + 30000) {
    try { saveSession(await authRequest('refresh_token', { refresh_token: session.refresh_token })); }
    catch { saveSession(null); showLogin(); throw new Error('登录已过期，请重新登录。'); }
  }
  return session.access_token;
}
async function api(path, { method = 'GET', body, download = false } = {}) {
  const response = await fetch(`${config.apiBase.replace(/\/$/, '')}/quiz-admin/${path}`, {
    method, headers: { Authorization: `Bearer ${await token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store'
  });
  if (!response.ok) {
    let value;
    try { value = await response.json(); } catch { value = {}; }
    if (response.status === 401) { saveSession(null); showLogin(); }
    throw new Error(value.error?.message || '操作未完成，请稍后重试。');
  }
  return download ? response.blob() : response.json();
}
async function exportBatch(batchId) {
  const blob = await api(`batches/${encodeURIComponent(batchId)}/export`, { download: true });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `漫画测试兑换码-${batchId}.csv`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  status('CSV已生成，包含完整兑换码，请妥善保管。');
}
async function loadBatches() {
  const { batches } = await api('batches');
  const target = $('batches'); target.replaceChildren();
  if (!batches.length) { target.append(node('p', '还没有发码批次。', 'muted')); return; }
  for (const batch of batches) {
    const row = node('div', null, 'batch-row'), copy = node('div'), buttons = node('div', null, 'batch-actions');
    const title = config.works.find(work => work.id === batch.workId)?.title || batch.workId;
    copy.append(node('strong', `${title} · ${batch.count ?? batch.codeCount ?? 0}个码`));
    copy.append(node('small', `${localTime(batch.createdAt)}${batch.note ? ` · ${batch.note}` : ''}`));
    copy.append(node('small', batch.id));
    buttons.append(action('查看次数与状态', () => loadCodes(batch.id)), action('下载CSV', () => exportBatch(batch.id)));
    row.append(copy, buttons); target.append(row);
  }
}
async function loadCodes(batchId) {
  selectedBatch = batchId;
  const { codes } = await api(`codes?batchId=${encodeURIComponent(batchId)}`);
  $('codes-panel').hidden = false;
  $('batch-detail').textContent = `批次 ${batchId} · 共${codes.length}个码`;
  const rows = $('codes'); rows.replaceChildren();
  for (const code of codes) {
    const row = node('tr');
    row.append(node('td', code.maskedCode), node('td', `${code.usedCount} / ${code.maxUses}`));
    row.append(node('td', code.disabled ? '已停用' : code.usedCount >= code.maxUses ? '次数已用完' : '可使用', code.disabled ? 'status-disabled' : 'status-enabled'));
    const cell = node('td');
    cell.append(action(code.disabled ? '恢复使用' : '停用', async () => {
      await api(`codes/${encodeURIComponent(code.id)}/disable`, { method: 'POST', body: { disabled: !code.disabled } });
      await loadCodes(batchId);
      status(code.disabled ? '兑换码已恢复。' : '兑换码已停用，已有结果保留。');
    }));
    row.append(cell); rows.append(row);
  }
  $('codes-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function start() {
  const response = await fetch('config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('暂时无法读取网站配置。');
  config = await response.json();
  if (!config.apiBase || !config.authUrl || !config.publishableKey) {
    $('login-form').querySelector('button').disabled = true;
    throw new Error('后台尚未连接服务。请完成部署配置后再登录。');
  }
  for (const work of config.works) {
    const option = node('option', work.title); option.value = work.id; $('work-id').append(option);
  }
  try { session = JSON.parse(sessionStorage.getItem(sessionKey)); } catch { session = null; }
  if (session?.access_token) {
    try { await loadBatches(); showDashboard(); }
    catch (error) { saveSession(null); showLogin(); status(error.message, true); }
  }
  $('login-form').addEventListener('submit', event => {
    event.preventDefault();
    busy(event.submitter, async () => {
      saveSession(await authRequest('password', { email: $('email').value.trim(), password: $('password').value }));
      $('password').value = '';
      try { await loadBatches(); showDashboard(); status('已进入发码后台。'); }
      catch (error) { saveSession(null); showLogin(); throw error; }
    });
  });
  $('logout').addEventListener('click', () => busy($('logout'), async () => {
    try {
      await fetch(`${config.authUrl.replace(/\/$/, '')}/auth/v1/logout`, {
        method: 'POST', headers: { Authorization: `Bearer ${await token()}`, apikey: config.publishableKey }
      });
    } finally { saveSession(null); showLogin(); status('已退出登录。'); }
  }));
  $('batch-form').addEventListener('submit', event => {
    event.preventDefault();
    busy(event.submitter, async () => {
      const { batchId, count } = await api('batches', { method: 'POST', body: {
        workId: $('work-id').value, count: Number($('count').value), note: $('note').value.trim()
      } });
      await loadBatches(); await loadCodes(batchId);
      status(`已生成${count}个兑换码。可以下载CSV并人工交付。`);
    });
  });
  $('refresh').addEventListener('click', () => busy($('refresh'), loadBatches));
  $('export').addEventListener('click', () => busy($('export'), () => exportBatch(selectedBatch)));
  $('login-form').querySelector('button').disabled = false;
}
start().catch(error => status(error.message, true));

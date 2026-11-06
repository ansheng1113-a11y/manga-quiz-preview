export class ApiError extends Error {
  constructor(message, { code = 'NETWORK_ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export const normalizeCode = value => String(value).trim().toUpperCase().replace(/[\s-]/g, '');

export async function loadConfig() {
  const response = await fetch(new URL('config.json', import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('本站还未配置交付服务，请联系提供兑换码的人。');
  const config = await response.json();
  if (!Array.isArray(config.works) || !config.works.length) throw new Error('本站尚未配置可用的测试。');
  return config;
}

export function apiConfigured(config) {
  if (typeof config.apiBase !== 'string' || !config.apiBase.trim()) return false;
  return /^https:\/\//.test(config.apiBase) || /^(?:http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?|\/api(?:\/|$))/.test(config.apiBase);
}

export async function apiRequest(config, action, payload) {
  if (!apiConfigured(config)) throw new ApiError('交付服务尚未配置，当前只能浏览测试介绍。', { code: 'NOT_CONFIGURED' });
  const base = config.apiBase.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (config.publishableKey) headers.apikey = config.publishableKey;
  let response;
  try {
    response = await fetch(`${base}/quiz-api/${action}`, {
      method: 'POST', headers, body: JSON.stringify(payload), cache: 'no-store', referrerPolicy: 'no-referrer'
    });
  } catch {
    throw new ApiError('暂时无法连接交付服务，请检查网络后重试。');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new ApiError('交付服务没有返回完整结果，请稍后重试。', { status: response.status >= 400 ? response.status : 502 }); }
  if (!response.ok || data.error) {
    throw new ApiError(data.error?.message || '这次请求未完成，请稍后重试。', { code: data.error?.code || 'REQUEST_FAILED', status: response.status });
  }
  return data;
}

export async function codeFingerprint(code) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeCode(code)));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function prepareSubmission(draft, contentVersion, persist) {
  if (draft.pending) return draft.pending;
  draft.pending = {
    requestId: crypto.randomUUID(), contentVersion, questionVersion: draft.questionVersion,
    answers: { ...draft.answers }
  };
  try {
    if (!persist()) throw new Error('浏览器未能保存提交编号。请允许本站存储后再提交，本次尚未发送。');
  } catch (error) {
    draft.pending = null;
    throw error;
  }
  return draft.pending;
}

export function draftStorageKey(workId, questionVersion, fingerprint) {
  return `manga-quiz-delivery.draft:${workId}:${questionVersion}:${fingerprint}`;
}

export function normalizeDraft(raw, quiz) {
  const answers = {};
  if (raw?.questionVersion === quiz.questionVersion) {
    for (const question of quiz.questions) {
      if (question.options.some(option => option.id === raw.answers?.[question.id])) answers[question.id] = raw.answers[question.id];
    }
  }
  return {
    questionVersion: quiz.questionVersion,
    contentVersion: quiz.version,
    answers,
    index: Number.isInteger(raw?.index) ? Math.max(0, Math.min(raw.index, quiz.questions.length - 1)) : 0,
    pending: raw?.pending?.requestId && raw.pending.answers && raw.pending.contentVersion ? raw.pending : null
  };
}

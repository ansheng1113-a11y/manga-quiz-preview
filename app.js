import { ApiError, apiConfigured, apiRequest, codeFingerprint, draftStorageKey, loadConfig, normalizeCode, normalizeDraft, prepareSubmission } from './client.js';
import { createAutoAdvance } from './auto-advance.js';
import { renderRadar } from './radar.js';
import { runNinjaStart } from './ninja-motion.js';
import { fetchGif, publicEntryUrl } from './media.js';
import { createResultPoster } from './poster.js';

const root = document.querySelector('#app');
const h = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const autoAdvance = createAutoAdvance(advanceQuestion);
const codeKey = workId => `manga-quiz-delivery.code:${workId}`;
let config, work, quiz, access, code = '', fingerprint, draft, draftKey, pointerKey, result;
let versionNotice = '', storageAvailable = true, busy = false, readOnly = false, readIndex = 0, exportedUrl;
let clearResultMedia = () => {}, exportedResultId;

function readStorage(storage, key) {
  try { return JSON.parse(storage.getItem(key)); } catch { return null; }
}

function writeDraft() {
  try {
    localStorage.setItem(draftKey, JSON.stringify(draft));
    localStorage.setItem(pointerKey, JSON.stringify({ key: draftKey, questionVersion: quiz.questionVersion }));
    return true;
  } catch { storageAvailable = false; return false; }
}

function restoreDraft() {
  draftKey = draftStorageKey(work.id, quiz.questionVersion, fingerprint);
  pointerKey = `manga-quiz-delivery.current:${work.id}:${fingerprint}`;
  const previous = readStorage(localStorage, pointerKey);
  const saved = readStorage(localStorage, draftKey);
  draft = normalizeDraft(saved, quiz);
  versionNotice = '';
  if (previous?.questionVersion !== quiz.questionVersion && previous?.key) {
    const oldDraft = readStorage(localStorage, previous.key);
    if (oldDraft) {
      try { localStorage.setItem(`${pointerKey}.previous`, JSON.stringify(oldDraft)); } catch { storageAvailable = false; }
      versionNotice = '题目情景已更新，旧草稿已保留备份。这次请重新作答，旧答案没有套入新题。';
      if (oldDraft.pending && !draft.pending) {
        draft.pending = oldDraft.pending;
        versionNotice = '上一版本有一份提交尚未确认。请先确认原提交结果，系统会沿用原请求编号。';
      }
    }
  }
  writeDraft();
}

function focusHeading() {
  const heading = root.querySelector('h1');
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function showMessage(message, isError = false) {
  let status = root.querySelector('.delivery-message');
  if (!status) { status = document.createElement('p'); status.className = 'delivery-message'; root.prepend(status); }
  status.setAttribute('role', isError ? 'alert' : 'status');
  status.classList.toggle('is-error', isError);
  status.textContent = message;
}

function asset(path) {
  if (!path) return '';
  const url = new URL(path, document.baseURI);
  return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
}

function newAllowed() {
  return access && !access.disabled && access.remaining > 0 && access.contentVersion === quiz.version;
}

function dateText(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function quotaText() {
  if (!access) return '';
  if (access.disabled) return '此兑换码已停用，仍可查看已生成的档案。';
  if (access.contentVersion !== quiz.version) return '当前页面与交付服务的题库版本不同，请刷新后再开始。历史档案仍可查看。';
  return `剩余 ${access.remaining} / ${access.maxUses} 次 · 成功生成一份新结果使用1次`;
}

function sessionBar() {
  return `<div class="session-bar"><span>${h(quotaText())}</span><button id="change-code" class="text-link">更换兑换码</button></div>`;
}

function bindSessionBar() {
  root.querySelector('#change-code')?.addEventListener('click', () => {
    if (busy) return;
    try { sessionStorage.removeItem(codeKey(work.id)); } catch { /* A page-local session can still end. */ }
    code = ''; access = null; result = null; draft = null; renderHome(); focusHeading();
  });
}

function renderHome() {
  clearResultMedia();
  autoAdvance.cancel(); root.dataset.page = 'home'; readOnly = false;
  const answered = Object.keys(draft?.answers || {}).length;
  const cast = quiz.characters.filter(character => ['naruto', 'sasuke', 'sakura', 'kakashi'].includes(character.id));
  const history = access?.history || [];
  root.innerHTML = `${access ? sessionBar() : ''}${versionNotice && access ? `<p class="notice" role="status">${h(versionNotice)}</p>` : ''}
    <section class="hero comic-cover">
      <div class="hero-copy"><div class="eyebrow ninja-scroll-label">木叶来信 / 你的忍者篇章</div>
        <h1><span>你是</span><em>《${h(quiz.workTitle)}》</em><span>中的谁？</span></h1>
        <p class="intro">直说，还是绕个弯？坚持，还是换条路？从日常里的选择，找到与你接近的人物。</p>
        <div class="meta-row"><div class="meta-item"><strong>${quiz.questions.length}</strong><span>日常选择</span></div><div class="meta-item"><strong>${quiz.characters.length}</strong><span>人物原型</span></div><div class="meta-item"><strong>${quiz.axes.length}</strong><span>作答取向</span></div></div>
        ${access ? `<div class="hero-start"><button id="start" class="btn" ${!draft.pending && !newAllowed() ? 'disabled' : ''}>${draft.pending ? '确认上次提交' : answered ? '继续我的卷轴' : '展开忍者卷轴'} →</button><p class="start-note">${answered ? `已保存 ${answered} / ${quiz.questions.length} 道选择 · ` : ''}无需剧情知识 · 可随时停下，草稿自动保留</p></div>` : `<form id="access-form" class="code-form"><label for="redemption-code">输入你收到的兑换码</label><input id="redemption-code" name="code" type="text" maxlength="100" autocomplete="off" autocapitalize="characters" spellcheck="false" required placeholder="请输入兑换码" ${!apiConfigured(config) ? 'disabled' : ''}><button class="btn" type="submit" ${!apiConfigured(config) ? 'disabled' : ''}>验证兑换码 →</button><p class="code-note">每码可生成3份结果。刷新、续答和查看已有档案不扣次数。</p>${!apiConfigured(config) ? '<p class="notice">交付服务尚未配置，当前可浏览测试介绍。</p>' : ''}<p class="delivery-message" role="status"></p></form>`}
      </div><figure class="hero-art hero-illustration"><picture><source type="image/webp" srcset="cards/kakashi/assets/hero-subject.webp"><img src="cards/kakashi/assets/hero-subject.png" width="1024" height="1536" fetchpriority="high" decoding="async" alt="旗木卡卡西角色插画"></picture><figcaption>你的忍道，由你选择。</figcaption></figure>
    </section>
    ${access ? `<section class="history-section"><h2 class="home-section-title">我的结果档案</h2>${history.length ? `<div class="history-list">${history.map(item => `<button class="history-item" data-result-id="${h(item.resultId)}"><span><strong>${h(item.characterName)}</strong><small>${h(dateText(item.createdAt))}</small></span><span>${item.matchCount} / ${item.totalQuestions} 题符合 <span aria-hidden="true">↗</span></span></button>`).join('')}</div>` : '<p class="muted">还没有生成档案。完成卷轴后，你的结果会保存在这里。</p>'}</section>` : ''}
    <div class="ribbon"><span>循自己的心意选择</span><span>点选后自动进入下一题 →</span></div>
    <h2 class="home-section-title">本篇登场</h2><div class="cast-strip">${cast.map(character => `<div class="cast-panel"><img src="${h(asset(character.card.still))}" width="360" height="500" alt="${h(character.name)}闪卡" loading="lazy"><span>${h(character.name)}</span></div>`).join('')}</div>
    <section><h2 class="home-section-title">选择的${quiz.axes.length}个侧面</h2><div class="themes-grid">${quiz.axes.map((axis, index) => `<article class="theme-card"><span>${String(index + 1).padStart(2, '0')}</span><h3>${h(axis.name)}</h3><p>${h(axis.lowLabel)}，还是${h(axis.highLabel)}？</p></article>`).join('')}</div></section>
    <section class="roster"><h2 class="home-section-title">还有他们</h2><div class="roster-chips">${quiz.characters.map(character => `<span>${h(character.name)}</span>`).join('')}</div></section>
    <p class="home-notes">这是围绕人物处事方式的趣味匹配，无需剧情知识。结果不代表人格概率或准确率。兑换码只在当前标签页保留，关闭后可重新输入；每份草稿独立保存于当前浏览器。</p>`;
  bindSessionBar();
  root.querySelector('#access-form')?.addEventListener('submit', verifyCode);
  root.querySelector('#start')?.addEventListener('click', event => runNinjaStart(event.currentTarget, () => {
    if (!access || !draft || busy) return;
    if (draft.pending) renderReview(); else if (newAllowed()) renderQuestion();
    focusHeading();
  }));
  root.querySelectorAll('[data-result-id]').forEach(button => button.addEventListener('click', () => openResult(button.dataset.resultId, button)));
}

async function verifyCode(event) {
  event.preventDefault();
  const form = event.currentTarget, entered = normalizeCode(form.elements.code.value), button = form.querySelector('button');
  if (!entered || busy) return;
  busy = true; button.disabled = true; showMessage('正在验证兑换码…');
  try {
    const grant = await apiRequest(config, 'access', { workId: work.id, code: entered });
    const hash = await codeFingerprint(entered);
    code = entered; fingerprint = hash; access = grant;
    try { sessionStorage.setItem(codeKey(work.id), JSON.stringify(code)); } catch { storageAvailable = false; }
    restoreDraft(); renderHome(); focusHeading();
  } catch (error) { showMessage(error.message, true); button.disabled = false; }
  finally { busy = false; }
}

function renderQuestion(snapshot = false) {
  clearResultMedia();
  autoAdvance.cancel(); root.dataset.page = 'quiz'; readOnly = snapshot;
  if (snapshot && result.questionVersion !== quiz.questionVersion) {
    renderResult(); showMessage('这份档案使用旧版题目，当前页面不将旧答案套入新题。'); return;
  }
  if (!snapshot && draft.pending) { renderReview(); return; }
  const index = snapshot ? readIndex : draft.index, question = quiz.questions[index];
  const answers = snapshot ? result.answers : draft.answers, selected = answers[question.id];
  const options = [...question.options.slice(index % 4), ...question.options.slice(0, index % 4)];
  const answered = Object.keys(answers).length;
  root.innerHTML = `${sessionBar()}<section class="quiz-container comic-quiz" data-question-id="${h(question.id)}">
    ${snapshot ? '<p class="notice">正在回看已生成档案的作答，原结果不会被修改。</p>' : !storageAvailable ? '<p class="notice">当前浏览器无法保存草稿，请允许站点存储后再提交。</p>' : ''}
    <div class="quiz-top"><span>${h(quiz.themes.find(theme => theme.id === question.themeId)?.label || '日常取舍')}</span><span>${String(index + 1).padStart(2, '0')} / ${quiz.questions.length}</span></div>
    <div class="progress-track" role="progressbar" aria-label="答题进度" aria-valuenow="${answered}" aria-valuemin="0" aria-valuemax="${quiz.questions.length}"><i style="width:${answered / quiz.questions.length * 100}%"></i></div>
    <div class="question-statement"><div class="question-index" aria-hidden="true"><small>第</small><strong>${String(index + 1).padStart(2, '0')}</strong><small>问</small></div><h1>${h(question.title)}</h1></div>
    ${question.context ? `<p class="question-context">${h(question.context)}</p>` : ''}
    <div class="options" role="group" aria-label="请选择最接近自己的做法">${options.map((option, order) => `<button class="option" data-option="${h(option.id)}" aria-pressed="${selected === option.id}" ${snapshot ? 'disabled' : ''}><span class="option-letter" aria-hidden="true">${String.fromCharCode(65 + order)}</span><span>${h(option.text)}</span></button>`).join('')}</div>
    <div class="quiz-nav"><button id="previous" class="btn secondary" ${index === 0 ? 'disabled' : ''}>← 上一题</button><button id="next" class="btn" ${!selected ? 'disabled' : ''}>${index === quiz.questions.length - 1 ? snapshot ? '返回结果档案' : '检查并提交 →' : '下一题 →'}</button></div>
    ${!snapshot && answered === quiz.questions.length && index < quiz.questions.length - 1 ? '<button id="review" class="text-link review-link">已答完全部题目，检查并提交 →</button>' : ''}
    <p class="quiz-hint">${snapshot ? '按原始作答展示，可返回结果后复制成新草稿。' : '选择后自动进入下一题，可返回修改。提交前不扣次数。'}<br><button id="pause" class="text-link">${snapshot ? '返回结果档案' : '返回首页 · 保留草稿'}</button></p></section>`;
  bindSessionBar();
  if (!snapshot) root.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => {
    if (!newAllowed() || busy) return;
    draft.answers[question.id] = button.dataset.option; writeDraft();
    root.querySelectorAll('[data-option]').forEach(optionButton => optionButton.setAttribute('aria-pressed', String(optionButton.dataset.option === draft.answers[question.id])));
    const count = Object.keys(draft.answers).length, track = root.querySelector('.progress-track');
    track.setAttribute('aria-valuenow', String(count)); track.firstElementChild.style.width = `${count / quiz.questions.length * 100}%`;
    root.querySelector('#next').disabled = false;
    autoAdvance.schedule();
  }));
  root.querySelector('#previous').addEventListener('click', () => {
    if (snapshot) readIndex--; else { draft.index--; writeDraft(); }
    renderQuestion(snapshot); focusHeading();
  });
  root.querySelector('#next').addEventListener('click', advanceQuestion);
  root.querySelector('#review')?.addEventListener('click', () => { renderReview(); focusHeading(); });
  root.querySelector('#pause').addEventListener('click', () => { if (snapshot) renderResult(); else renderHome(); focusHeading(); });
}

function advanceQuestion() {
  autoAdvance.cancel();
  if (readOnly) {
    if (readIndex < quiz.questions.length - 1) { readIndex++; renderQuestion(true); } else renderResult();
  } else if (draft.answers[quiz.questions[draft.index].id]) {
    if (draft.index < quiz.questions.length - 1) { draft.index++; writeDraft(); renderQuestion(); }
    else {
      const missing = quiz.questions.findIndex(question => !draft.answers[question.id]);
      if (missing >= 0) { draft.index = missing; writeDraft(); renderQuestion(); } else renderReview();
    }
  }
  focusHeading();
}

function renderReview(message = '') {
  clearResultMedia();
  autoAdvance.cancel(); root.dataset.page = 'review'; readOnly = false;
  const pending = draft.pending;
  root.innerHTML = `${sessionBar()}<section class="delivery-review"><div class="eyebrow">人物之卷 / ${pending ? '确认提交' : '准备生成'}</div><h1>${pending ? '确认上次提交的结果' : '你的卷轴，已经写好了。'}</h1><p>${pending ? '上次提交尚未收到完整确认。原请求编号与答案已保存，重试会确认同一份结果，不会另起一次测试。' : `已完成${quiz.questions.length}道选择。成功生成这份新档案将使用1次，刷新或重试同一提交不重复扣次。`}</p><p class="delivery-message ${message ? 'is-error' : ''}" role="status">${h(message)}</p><div class="result-actions"><button id="submit-result" class="btn" ${!pending && !newAllowed() ? 'disabled' : ''}>${pending ? '重试确认结果 →' : '提交并生成档案（使用1次）'}</button>${!pending ? '<button id="edit-draft" class="btn secondary">返回修改</button>' : ''}<button id="review-home" class="btn secondary">返回首页</button></div><p class="fine-print">只有交付服务成功保存结果后，才会使用兑换次数。</p></section>`;
  bindSessionBar();
  root.querySelector('#submit-result').addEventListener('click', submitCurrent);
  root.querySelector('#edit-draft')?.addEventListener('click', () => { draft.index = 0; writeDraft(); renderQuestion(); focusHeading(); });
  root.querySelector('#review-home').addEventListener('click', () => { renderHome(); focusHeading(); });
}

async function submitCurrent() {
  if (busy || (!draft.pending && !newAllowed())) return;
  if (!draft.pending) {
    if (quiz.questions.some(question => !question.options.some(option => option.id === draft.answers[question.id]))) {
      showMessage('请先完成全部题目。', true); return;
    }
  }
  let pending;
  try { pending = prepareSubmission(draft, access.contentVersion, writeDraft); }
  catch (error) { showMessage(error.message, true); return; }
  busy = true;
  const button = root.querySelector('#submit-result'); button.disabled = true; button.textContent = '正在确认档案…';
  try {
    const packet = await apiRequest(config, 'submit', { workId: work.id, code, contentVersion: pending.contentVersion, requestId: pending.requestId, answers: pending.answers });
    acceptResult(packet);
    draft = normalizeDraft(null, quiz); writeDraft();
    renderResult(); focusHeading();
  } catch (error) {
    const rejected = error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status) && !/request|idempot|conflict/i.test(error.code);
    if (rejected) {
      draft.pending = null; writeDraft();
      try { access = await apiRequest(config, 'access', { workId: work.id, code }); } catch { /* Preserve the last confirmed allowance. */ }
    }
    renderReview(error.message + (rejected ? ' 本次未生成新档案。' : ' 请用原提交重试确认。'));
  } finally { busy = false; }
}

function acceptResult(packet) {
  if (!packet.result?.resultId || packet.result.workId !== work.id || !packet.result.primary?.character?.name || !Array.isArray(packet.result.evidence) || !Array.isArray(packet.result.nearby) || !Number.isInteger(packet.remaining)) {
    throw new ApiError('交付服务未返回完整档案，请用原提交重试确认。', { status: 502 });
  }
  result = packet.result;
  access.remaining = packet.remaining;
  const item = { resultId: result.resultId, characterName: result.primary.character.name, matchCount: result.primary.matchCount, totalQuestions: result.totalQuestions, createdAt: result.createdAt };
  access.history = [item, ...(access.history || []).filter(previous => previous.resultId !== item.resultId)].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

async function openResult(resultId, button) {
  if (busy) return;
  busy = true; button.disabled = true;
  try {
    acceptResult(await apiRequest(config, 'result', { workId: work.id, code, resultId }));
    renderResult(); focusHeading();
  } catch (error) { showMessage(error.message, true); button.disabled = false; }
  finally { busy = false; }
}

function renderResult() {
  clearResultMedia();
  autoAdvance.cancel(); root.dataset.page = 'result'; readOnly = false;
  const entry = result.primary, character = entry.character, first = result.evidence[0], different = result.difference;
  const sameQuestions = result.questionVersion === quiz.questionVersion;
  const choice = item => `<article class="evidence-card" data-question-id="${h(item.question.id)}"><small>${h(item.question.title)}</small><blockquote>你选了：“${h(item.option.text)}”</blockquote><p>${h(item.explanation)}</p></article>`;
  root.innerHTML = `${sessionBar()}<section class="result-container"><article class="result-poster-layout comic-result"><div class="result-opening"><div class="eyebrow">人物之卷 / 测试结果</div><p class="poster-heading">你是《${h(work.title)}》中的——</p></div>
    <div class="result-feature"><div class="result-portrait"><picture class="holo-animation"><img id="result-portrait" src="${h(asset(character.card.still))}" data-still="${h(asset(character.card.still))}" width="360" height="500" alt="${h(character.name)}静态闪卡" decoding="async" fetchpriority="high"></picture><div class="card-download"><button id="play-animation" class="text-link" type="button" aria-pressed="false">播放流光闪卡</button><button id="save-animation" class="text-link" type="button">保存 GIF ↓</button><p id="animation-status" role="status"></p></div></div>
    <div class="result-identity"><div class="character-label">${h(character.archetypeLabel)}</div><h1 class="result-name">${h(character.name)}</h1><div class="character-traits">${character.keywords.map(word => `<span>${h(word)}</span>`).join('')}</div><div class="match-count"><strong>${entry.matchCount}</strong><span>／${result.totalQuestions}题符合</span></div>${result.tieCount > 1 ? `<p class="fine-print">有${result.tieCount}位人物同分，按固定名单顺序展示主卡。</p>` : ''}<p class="result-core-trait">${h(character.epithet)}</p>${first ? `<aside class="choice-preview"><small>你的选择中，有这样一个对应点</small><blockquote>你选了：“${h(first.option.text)}”</blockquote><p>${h(first.explanation)}</p><a href="#result-evidence">查看作答依据 →</a></aside>` : ''}</div></div><div class="poster-conclusion"><p class="result-conclusion">${h(character.resultConclusion)}</p></div></article>
    <div class="result-actions"><button id="save-card" class="btn">生成分享结果卡 ↓</button><button id="copy-test-link" class="btn secondary">复制测试链接</button><button id="read-answers" class="btn secondary" ${!sameQuestions ? 'disabled' : ''}>回看原作答</button><button id="copy-answers" class="btn secondary" ${!newAllowed() || draft.pending ? 'disabled' : ''}>修改后重新生成</button><button id="result-home" class="btn secondary">我的档案</button></div>
    <div id="share-link-status" class="status-text" role="status"></div>
    <p class="fine-print">查看和保存本档案不扣次数。修改答案会复制为新草稿，再次生成新结果使用1次。</p><div id="copy-confirm" class="copy-confirm" hidden><p>${sameQuestions ? '将原答案复制为一份新草稿，原结果继续保留。' : '题目情景已更新，将开始一份空白草稿。'}${Object.keys(draft.answers).length ? '当前未提交的草稿会被替换。' : ''}提交新草稿成功后使用1次。</p><button id="confirm-copy" class="btn small">${sameQuestions ? '复制并修改' : '开始新草稿'}</button><button id="cancel-copy" class="btn secondary small">保留原档案</button></div>
    <div id="export-status" class="status-text" role="status"></div>
    <section class="report"><div class="report-title"><h2>接近人物</h2><span>第2–4名</span></div><div class="nearby-list">${result.nearby.map((item, index) => `<article class="nearby-item"><span class="nearby-rank">${String(index + 2).padStart(2, '0')}</span><div class="nearby-name"><h3>${h(item.character.name)}</h3><p>${h(item.character.archetypeLabel)}</p></div><div class="nearby-count"><strong>${item.matchCount}／${result.totalQuestions}题符合</strong>${item.isTied ? '<small>同分</small>' : ''}</div></article>`).join('')}</div></section>
    ${character.quote ? `<blockquote class="character-quote">“${h(character.quote.text)}”<footer>${h(character.quote.reference)} · <a href="${h(character.quote.sourceUrl)}" target="_blank" rel="noopener">原文出处 ↗</a></footer></blockquote>` : ''}
    ${sameQuestions ? renderRadar(quiz, result.answers) : '<p class="notice">这是旧题意版本保存的档案，保留原结论与依据，不用新版题目重算雷达。</p>'}
    <section class="report" id="result-evidence"><div class="report-title"><h2>你的选择里，哪些地方像？</h2></div><div class="evidence-grid">${result.evidence.map(choice).join('') || '<p>这次没有与主人物完全相同的选择，相对接近不代表全部相同。</p>'}</div>
      <div class="report-block"><h3>也有不一样的地方</h3>${different ? `<p>在“${h(different.question.title)}”里，你选择“${h(different.option.text)}”；这份人物原型更倾向“${h(different.reference.text)}”。</p><p>${h(different.explanation)}</p>` : `<p>本次选择与这份人物原型全部一致；${result.totalQuestions}道题仍不能覆盖完整性格。</p>`}</div>
      <details class="report-block"><summary>展开人物性格分析</summary><div class="report-block"><h3>这个人物在意什么</h3><p>${h(character.motivation)}</p></div><div class="comparison-grid"><section class="comparison-box"><h3>这种方式能带来什么</h3><ul>${character.strengths.map(item => `<li>${h(item)}</li>`).join('')}</ul></section><section class="comparison-box"><h3>可能付出的代价</h3><ul>${character.costs.map(item => `<li>${h(item)}</li>`).join('')}</ul></section></div><div class="report-block"><h3>这个人物怎样与人相处</h3><p>${h(character.relationships)}</p></div><div class="report-block"><h3>如果这些侧面也像你</h3><ul>${character.advice.map(item => `<li>${h(item)}</li>`).join('')}</ul></div></details>
    </section><p class="result-note">符合数表示本次选择与人物代表答案一致的题数。日常情景为性格推演，结果供趣味参考。</p></section>`;
  bindSessionBar();
  bindResultMedia(character);
  root.querySelector('#save-card').addEventListener('click', exportResult);
  root.querySelector('#copy-test-link').addEventListener('click', async () => {
    const url = publicEntryUrl(document.baseURI), status = root.querySelector('#share-link-status');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      status.textContent = '测试入口已复制。可与结果卡一起分享；链接不包含你的兑换码或作答。';
    } catch {
      status.innerHTML = `<label>请长按复制测试入口<input class="share-url" readonly value="${h(url)}"></label>`;
      const field = status.querySelector('input'); field.focus(); field.select();
    }
  });
  root.querySelector('#result-home').addEventListener('click', () => { renderHome(); focusHeading(); });
  root.querySelector('#read-answers').addEventListener('click', () => { readIndex = 0; renderQuestion(true); focusHeading(); });
  root.querySelector('#copy-answers').addEventListener('click', () => { root.querySelector('#copy-confirm').hidden = false; root.querySelector('#confirm-copy').focus(); });
  root.querySelector('#cancel-copy').addEventListener('click', () => { root.querySelector('#copy-confirm').hidden = true; root.querySelector('#copy-answers').focus(); });
  root.querySelector('#confirm-copy').addEventListener('click', () => {
    if (!newAllowed() || draft.pending) return;
    draft = normalizeDraft(sameQuestions ? { questionVersion: quiz.questionVersion, answers: result.answers } : null, quiz);
    writeDraft(); renderQuestion(); showMessage('已复制为新草稿。原档案保留，再次提交成功将使用1次。'); focusHeading();
  });
}

async function exportResult() {
  const button = root.querySelector('#save-card'), status = root.querySelector('#export-status');
  const snapshot = result;
  button.disabled = true; button.textContent = '正在生成结果卡…'; button.setAttribute('aria-busy', 'true');
  status.textContent = '正在准备图片，生成后可长按保存。';
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!root.contains(button) || result.resultId !== snapshot.resultId) return;
    if (!exportedUrl || exportedResultId !== snapshot.resultId) {
      const { blob } = await createResultPoster(snapshot.primary, { workTitle: work.title, totalQuestions: snapshot.totalQuestions,
        tied: snapshot.tieCount > 1, portraitImage: root.querySelector('#result-portrait') });
      if (!root.contains(button) || result.resultId !== snapshot.resultId) return;
      if (exportedUrl) URL.revokeObjectURL(exportedUrl);
      exportedUrl = URL.createObjectURL(blob); exportedResultId = snapshot.resultId;
    }
    const link = document.createElement('a'), filename = `你是${work.title}中的谁-${snapshot.primary.character.name}.png`;
    link.href = exportedUrl; link.download = filename; document.body.append(link); link.click(); link.remove();
    status.innerHTML = `<p>结果卡已生成。手机可长按下图保存；也可<a href="${exportedUrl}" download="${h(filename)}">下载 PNG ↓</a>。分享时可另点“复制测试链接”。</p><img class="export-preview" src="${exportedUrl}" alt="${h(snapshot.primary.character.name)}结果卡，${snapshot.primary.matchCount}／${snapshot.totalQuestions}题符合">`;
    status.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { status.textContent = error.message || '暂时未能生成结果卡，请重试。'; }
  finally { button.disabled = false; button.textContent = '生成分享结果卡 ↓'; button.removeAttribute('aria-busy'); }
}

function bindResultMedia(character) {
  const portrait = root.querySelector('#result-portrait'), play = root.querySelector('#play-animation');
  const save = root.querySelector('#save-animation'), status = root.querySelector('#animation-status');
  const controller = new AbortController();
  let pending, url, playing = false;
  clearResultMedia = () => { controller.abort(); if (url) URL.revokeObjectURL(url); clearResultMedia = () => {}; };
  portrait.addEventListener('error', () => {
    if (!url) return;
    URL.revokeObjectURL(url); url = null; pending = null; playing = false;
    portrait.src = asset(character.card.still); portrait.alt = `${character.name}静态闪卡`;
    play.textContent = '播放流光闪卡'; play.setAttribute('aria-pressed', 'false');
    status.textContent = '动图未完整显示，已保留静态卡，请重试。';
  });
  async function load(download) {
    if (playing && !download) {
      portrait.src = asset(character.card.still); portrait.alt = `${character.name}静态闪卡`;
      playing = false; play.textContent = '播放流光闪卡'; play.setAttribute('aria-pressed', 'false'); return;
    }
    play.disabled = save.disabled = true; status.textContent = '正在准备GIF，静态卡可以先查看…';
    try {
      if (!url) {
        pending ||= fetchGif(asset(character.card.animation), { signal: controller.signal,
          onProgress: percent => { status.textContent = percent == null ? '正在加载GIF…' : `正在加载GIF ${percent}%…`; } });
        const blob = await pending;
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
      }
      if (controller.signal.aborted) return;
      portrait.src = url; portrait.alt = `${character.name}流光闪卡`; playing = true;
      play.textContent = '暂停动效'; play.setAttribute('aria-pressed', 'true');
      status.innerHTML = `GIF已准备，可长按上方图片保存，或<a href="${url}" download="${h(character.name)}-闪卡.gif">下载 GIF ↓</a>。`;
      if (download) status.querySelector('a').click();
    } catch (error) {
      pending = null;
      if (!controller.signal.aborted) status.innerHTML = `${h(error.message || 'GIF暂时无法加载，请重试。')} <a href="${h(asset(character.card.animation))}" target="_blank" rel="noopener">打开原GIF</a>`;
    } finally { play.disabled = save.disabled = false; }
  }
  play.addEventListener('click', () => load(false)); save.addEventListener('click', () => load(true));
}

root.addEventListener('error', event => {
  const image = event.target;
  if (image.tagName !== 'IMG' || !image.dataset.still || image.dataset.fallback) return;
  image.dataset.fallback = 'true';
  image.closest('picture')?.querySelectorAll('source').forEach(source => source.remove());
  image.src = image.dataset.still;
  image.alt = image.alt.replace('自动流光闪卡', '静态闪卡');
}, true);

async function start() {
  config = await loadConfig();
  work = config.works.find(item => item.id === 'naruto');
  if (!work) throw new Error('当前尚未配置火影人物测试。');
  const response = await fetch(new URL(work.contentUrl, document.baseURI), { cache: 'no-store' });
  if (!response.ok) throw new Error('题库暂时无法读取，请稍后刷新。');
  quiz = await response.json(); document.title = quiz.title;
  renderHome();
  const savedCode = readStorage(sessionStorage, codeKey(work.id));
  if (typeof savedCode === 'string' && savedCode && apiConfigured(config)) {
    const field = root.querySelector('#redemption-code'); field.value = savedCode;
    root.querySelector('#access-form').requestSubmit();
  }
}

start().catch(error => {
  root.innerHTML = `<section class="error-card"><div class="eyebrow">档案暂未展开</div><h1>卷轴正在准备。</h1><p>${h(error.message)}</p><button class="btn" id="retry">重新加载 ↻</button></section>`;
  root.querySelector('#retry').addEventListener('click', () => location.reload());
});

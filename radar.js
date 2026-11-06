const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function calculateRadar(quiz, answers) {
  return (quiz.axes || []).map(axis => {
    const questions = quiz.questions.filter(q => q.axisId === axis.id);
    const selected = questions.map(q => q.options.find(o => o.id === answers[q.id])).filter(o => typeof o?.value === 'number');
    const complete = questions.length > 0 && selected.length === questions.length;
    return { ...axis, answered: selected.length, total: questions.length, value: complete ? selected.reduce((sum, o) => sum + o.value, 0) / selected.length * 4 / 3 : null };
  });
}

export function renderRadar(quiz, answers, { sample = false, values } = {}) {
  const axes = calculateRadar(quiz, answers).map((axis, i) => sample && values ? { ...axis, value: values[i] ?? null } : axis);
  if (!axes.length) return '';
  const complete = axes.every(axis => axis.value !== null);
  const point = (i, value) => {
    const angle = -Math.PI / 2 + i * Math.PI / 3;
    return `${(180 + Math.cos(angle) * value * 24).toFixed(1)},${(150 + Math.sin(angle) * value * 24).toFixed(1)}`;
  };
  const description = axes.map(a => `${a.name}：${a.lowLabel}到${a.highLabel}，${a.value === null ? `已答${a.answered}/${a.total}题，暂不计算` : `${sample ? '示意值' : '本次选择'}${a.value.toFixed(1)}/4`}`).join('；');
  const labels = [[180, 26], [286, 88], [286, 222], [180, 286], [74, 222], [74, 88]];
  return `<section class="report choice-radar"><div class="report-title"><h2>选择里的六种取向</h2>${sample ? '<span>版式示意 · 非你的测评结果</span>' : ''}</div><figure class="radar-figure"><div class="radar-layout"><svg viewBox="0 0 360 300" role="img" aria-label="${escapeHtml(description)}"><g class="radar-grid">${[1, 2, 3, 4].map(v => `<polygon points="${axes.map((_, i) => point(i, v)).join(' ')}"/>`).join('')}${axes.map((_, i) => `<line x1="180" y1="150" x2="${point(i, 4).split(',')[0]}" y2="${point(i, 4).split(',')[1]}"/>`).join('')}</g>${complete ? `<polygon class="radar-shape" points="${axes.map((a, i) => point(i, a.value)).join(' ')}"/>` : axes.map((a, i) => a.value === null ? '' : `<circle class="radar-point" cx="${point(i, a.value).split(',')[0]}" cy="${point(i, a.value).split(',')[1]}" r="3"/>`).join('')}<g class="radar-labels" text-anchor="middle">${axes.map((a, i) => `<text x="${labels[i][0]}" y="${labels[i][1]}">${escapeHtml(a.name)}</text>`).join('')}</g></svg><div class="radar-legend">${axes.map(a => `<div class="radar-axis"><strong>${escapeHtml(a.name)}</strong><div class="radar-ends"><span>${escapeHtml(a.lowLabel)}</span><span aria-hidden="true">↔</span><span>${escapeHtml(a.highLabel)}</span></div>${a.value === null ? `<small>已答 ${a.answered} / ${a.total} 题，暂不计算</small>` : `<div class="radar-scale" style="--radar-position:${a.value / 4 * 100}%" aria-label="${sample ? '示意值' : '本次选择'} ${a.value.toFixed(1)} / 4"><i></i></div>`}</div>`).join('')}</div></div><figcaption>${sample ? '固定示意值，用于展示版式。' : ''}${complete ? '外圈表示更靠近每组右端，两端没有高下。' : '未答满的取向暂不连成图形，请补齐作答。'}</figcaption></figure></section>`;
}

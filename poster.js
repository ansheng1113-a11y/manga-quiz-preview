const WIDTH = 1080;
const COLORS = { paper: '#f3f1e9', ink: '#172638', accent: '#d95432', muted: '#697079', leaf: '#637964', sand: '#bc9b62', line: '#c8cbc7' };
const FONT = 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
const BRUSH = '"Kaiti SC", "STKaiti", "KaiTi", "Songti SC", "STSong", serif';

function exportError(code, message, retryable = true) {
  return Object.assign(new Error(message), { code, retryable });
}

async function within(promise, milliseconds, error) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(error), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function reusablePortrait(image, source) {
  if (!image?.complete || !(image.naturalWidth > 0 && image.naturalHeight > 0)) return false;
  try {
    return new URL(image.currentSrc || image.src, document.baseURI).href === new URL(source, document.baseURI).href;
  } catch { return false; }
}

async function loadPortrait(source) {
  const image = new Image();
  try {
    const loaded = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(exportError('IMAGE_LOAD_FAILED', '人物静态图未能加载，请检查网络后重试。'));
      image.src = source;
      if (typeof image.decode === 'function') {
        image.decode().then(() => resolve(image), () => {
          if (image.complete && image.naturalWidth > 0) resolve(image);
        });
      }
      if (image.complete && image.naturalWidth > 0) resolve(image);
    });
    await within(loaded, 8000, exportError('IMAGE_TIMEOUT', '人物静态图加载超时，请稍后重试。'));
    if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) {
      throw exportError('IMAGE_LOAD_FAILED', '人物静态图未能加载，请检查网络后重试。');
    }
    return image;
  } catch (error) {
    image.removeAttribute?.('src');
    if (['IMAGE_TIMEOUT', 'IMAGE_LOAD_FAILED'].includes(error.code)) throw error;
    throw exportError('IMAGE_LOAD_FAILED', '人物静态图未能加载，请检查网络后重试。');
  } finally { image.onload = null; image.onerror = null; }
}

function linesFor(ctx, text, width) {
  const lines = [];
  for (const paragraph of String(text || '').split('\n')) {
    let line = '';
    for (const character of paragraph) {
      if (line && ctx.measureText(line + character).width > width) {
        if (/[，。！？；：、）》】」』”’]/u.test(character) || /[（《【「『“‘]$/u.test(line)) {
          const carried = [...line];
          const last = carried.pop();
          lines.push(carried.join('')); line = last;
        } else {
          lines.push(line); line = '';
        }
      }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}

export async function createResultPoster(entry, { workTitle = '火影忍者', totalQuestions = 30, sample = false, tied = false, portraitImage } = {}) {
  if (document.fonts?.ready) {
    // The declared font stacks already contain local fallbacks; font loading must
    // not prevent saving a result when a WebView leaves this promise pending.
    await within(document.fonts.ready, 1000, new Error('Font wait expired')).catch(() => {});
  }
  const character = entry.character;
  let portrait;
  if (character.card?.still) {
    portrait = reusablePortrait(portraitImage, character.card.still)
      ? portraitImage : await loadPortrait(character.card.still);
  }
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.toBlob !== 'function') {
    throw exportError('CANVAS_UNAVAILABLE', '当前浏览器暂不支持保存结果卡，请用系统浏览器打开后重试。', false);
  }
  const blocks = [];
  let y = 86;
  function text(value, size, lineHeight, { weight = '400', color = COLORS.ink, width = 880, align = 'center', gap = 0, family = FONT } = {}) {
    if (!value) return;
    const font = `${weight} ${size}px ${family}`;
    ctx.font = font;
    const lines = linesFor(ctx, value, width);
    blocks.push({ kind: 'text', lines, font, lineHeight, y, color, align });
    y += lines.length * lineHeight + gap;
  }
  text(sample ? '测试结果 · 固定示例' : '测试结果', 22, 36, { color: COLORS.sand, gap: 12 });
  text(`你是《${workTitle}》中的——`, 38, 54, { weight: '700', color: COLORS.paper, family: BRUSH, gap: 54 });
  const headerBottom = y - 32;
  const cardWidth = 360;
  const cardHeight = portrait ? cardWidth * portrait.naturalHeight / portrait.naturalWidth : 240;
  blocks.push({ kind: 'card', x: (WIDTH - cardWidth) / 2, y, width: cardWidth, height: cardHeight });
  y += cardHeight + 44;
  text(character.archetypeLabel, 26, 40, { color: COLORS.leaf, gap: 6 });
  text(character.name, 68, 90, { weight: '800', family: BRUSH, gap: 22 });
  ctx.font = `26px ${FONT}`;
  const tags = (character.keywords || []).map(label => ({ label, width: ctx.measureText(label).width + 48 }));
  const tagWidth = tags.reduce((sum, tag) => sum + tag.width, 0) + Math.max(0, tags.length - 1) * 18;
  let x = (WIDTH - tagWidth) / 2;
  for (const tag of tags) {
    blocks.push({ kind: 'tag', x, y, width: tag.width, label: tag.label });
    x += tag.width + 18;
  }
  if (tags.length) y += 72;
  blocks.push({ kind: 'count', y });
  y += 104;
  text(character.epithet, 34, 54, { weight: '650', family: BRUSH, gap: 28 });
  blocks.push({ kind: 'rule', y: y - 8 });
  y += 32;
  text(character.resultConclusion || character.summary, 28, 48, { align: 'left', width: 864, gap: 32 });
  text(sample ? `示意计数，不来自个人作答` : `${totalQuestions}道日常选择 · 趣味人物测试${tied ? ' · 本次存在同分人物' : ''}`, 19, 30, { color: COLORS.muted });
  canvas.height = Math.ceil(y + 52);
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, WIDTH, canvas.height);
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 2;
  ctx.strokeRect(42, 42, WIDTH - 84, canvas.height - 84);
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(42, 42, WIDTH - 84, headerBottom - 42);
  ctx.textBaseline = 'alphabetic';
  for (const block of blocks) {
    if (block.kind === 'text') {
      ctx.textBaseline = 'top';
      ctx.font = block.font; ctx.fillStyle = block.color; ctx.textAlign = block.align;
      block.lines.forEach((line, index) => ctx.fillText(line, block.align === 'center' ? WIDTH / 2 : 108, block.y + index * block.lineHeight));
      ctx.textBaseline = 'alphabetic';
    } else if (block.kind === 'card') {
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(block.x - 20, block.y - 20, block.width + 40, block.height + 40);
      ctx.strokeStyle = COLORS.sand; ctx.lineWidth = 1;
      ctx.strokeRect(block.x - 12, block.y - 12, block.width + 24, block.height + 24);
      if (portrait) ctx.drawImage(portrait, block.x, block.y, block.width, block.height);
      else {
        ctx.fillStyle = COLORS.paper; ctx.fillRect(block.x, block.y, block.width, block.height);
        ctx.strokeStyle = COLORS.sand; ctx.lineWidth = 1;
        ctx.strokeRect(block.x, block.y, block.width, block.height);
        ctx.textAlign = 'center'; ctx.fillStyle = COLORS.muted; ctx.font = `20px ${FONT}`;
        ctx.fillText('人物文字卡', WIDTH / 2, block.y + 52);
        ctx.fillStyle = COLORS.ink; ctx.font = `700 38px ${BRUSH}`;
        const nameLines = linesFor(ctx, character.name, block.width - 40);
        nameLines.forEach((line, index) => ctx.fillText(line, WIDTH / 2, block.y + block.height / 2 + index * 56 - (nameLines.length - 1) * 28));
        ctx.fillStyle = COLORS.accent; ctx.fillRect(WIDTH / 2 - 25, block.y + block.height - 60, 50, 4);
      }
    } else if (block.kind === 'tag') {
      ctx.fillStyle = '#e8ece3'; ctx.fillRect(block.x, block.y, block.width, 46);
      ctx.strokeStyle = COLORS.leaf; ctx.lineWidth = 1;
      ctx.strokeRect(block.x, block.y, block.width, 46);
      ctx.font = `26px ${FONT}`; ctx.fillStyle = COLORS.leaf; ctx.textAlign = 'center';
      ctx.fillText(block.label, block.x + block.width / 2, block.y + 32);
    } else if (block.kind === 'count') {
      ctx.strokeStyle = COLORS.sand; ctx.lineWidth = 1;
      ctx.strokeRect(350, block.y, 380, 76);
      ctx.fillStyle = COLORS.accent; ctx.fillRect(350, block.y, 5, 76);
      const segments = [
        { value: String(entry.matchCount), font: '500 44px Arial', color: COLORS.accent },
        { value: ` / ${totalQuestions} `, font: '400 32px Arial', color: COLORS.ink },
        { value: '题符合', font: `28px ${FONT}`, color: COLORS.ink }
      ];
      const countWidth = segments.reduce((sum, segment) => {
        ctx.font = segment.font;
        segment.width = ctx.measureText(segment.value).width;
        return sum + segment.width;
      }, 0);
      let countX = (WIDTH - countWidth) / 2;
      ctx.textAlign = 'left';
      for (const segment of segments) {
        ctx.font = segment.font; ctx.fillStyle = segment.color;
        ctx.fillText(segment.value, countX, block.y + 51);
        countX += segment.width;
      }
    } else if (block.kind === 'rule') {
      ctx.strokeStyle = COLORS.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(108, block.y); ctx.lineTo(WIDTH - 108, block.y); ctx.stroke();
    }
  }
  let blob;
  try {
    blob = await within(new Promise(resolve => canvas.toBlob(resolve, 'image/png')), 5000,
      exportError('PNG_TIMEOUT', '结果卡生成超时，请稍后重试。'));
  } catch (error) {
    if (error.code === 'PNG_TIMEOUT') throw error;
    throw exportError('PNG_ENCODING_FAILED', '结果卡暂时未能生成，请稍后重试。');
  }
  if (!blob) throw exportError('PNG_ENCODING_FAILED', '结果卡暂时未能生成，请稍后重试。');
  return { canvas, blob };
}

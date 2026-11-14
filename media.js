export function publicEntryUrl(base) {
  return new URL('index.html', base).href;
}

export async function fetchGif(url, { signal, onProgress, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('GIF暂时无法下载，请重试。');
    const total = Number(response.headers.get('Content-Length')) || 0;
    const reader = response.body?.getReader();
    let blob;
    if (reader) {
      const chunks = []; let received = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value); received += value.byteLength;
        onProgress?.(total ? Math.min(99, Math.floor(received / total * 100)) : null);
      }
      blob = new Blob(chunks, { type: 'image/gif' });
    } else blob = await response.blob();
    const signature = await blob.slice(0, 6).text();
    const header = new Uint8Array(await blob.slice(0, 13).arrayBuffer());
    const trailer = new Uint8Array(await blob.slice(-1).arrayBuffer());
    if (blob.size < 14 || !/^GIF8[79]a$/.test(signature)
      || !(header[6] | header[7]) || !(header[8] | header[9]) || trailer[0] !== 0x3b) {
      throw new Error('没有收到完整的GIF图片，请重试。');
    }
    return blob;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('GIF加载较慢，已保留静态卡。可以重试或在系统浏览器打开。');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
  }
}

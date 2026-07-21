/**
 * توحيد قياس صفحة القالب إلى أبعاد template_config (PAGE_WIDTH × PAGE_HEIGHT)
 * مع احتواء المحتوى وحشو أبيض — نفس فكرة preprocess في Python.
 */

export async function rasterPdfFirstPageToTemplatePixels(
  pdfDataUrl: string,
  targetW: number,
  targetH: number
): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  const res = await fetch(pdfDataUrl);
  const buf = await res.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(
    targetW / Math.max(1, base.width),
    targetH / Math.max(1, base.height)
  );
  const viewport = page.getViewport({ scale: Math.max(0.01, scale) });
  const tmp = document.createElement("canvas");
  tmp.width = Math.max(1, Math.floor(viewport.width));
  tmp.height = Math.max(1, Math.floor(viewport.height));
  const tctx = tmp.getContext("2d");
  if (!tctx) {
    doc.destroy();
    throw new Error("canvas");
  }
  await page.render({ canvas: tmp, canvasContext: tctx, viewport }).promise;
  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const ctx = out.getContext("2d");
  if (!ctx) {
    doc.destroy();
    throw new Error("canvas");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetW, targetH);
  const dx = (targetW - tmp.width) / 2;
  const dy = (targetH - tmp.height) / 2;
  ctx.drawImage(tmp, dx, dy);
  doc.destroy();
  return out.toDataURL("image/png");
}

/**
 * رابط http(s) أو مسار — جلب Blob ثم object URL حتى لا يُلوَّث الـcanvas
 * (Image مع crossOrigin بدون رؤوس CORS يمنع toDataURL).
 */
export async function rasterImageUrlToTemplatePixels(
  imageUrl: string,
  targetW: number,
  targetH: number
): Promise<string> {
  const res = await fetch(imageUrl, { credentials: "same-origin" });
  if (!res.ok) throw new Error("image fetch");
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas"));
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetW, targetH);
        const nw = Math.max(1, img.naturalWidth);
        const nh = Math.max(1, img.naturalHeight);
        const scale = Math.min(targetW / nw, targetH / nh);
        const dw = nw * scale;
        const dh = nh * scale;
        const dx = (targetW - dw) / 2;
        const dy = (targetH - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("image"));
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function rasterImageDataUrlToTemplatePixels(
  imageDataUrl: string,
  targetW: number,
  targetH: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
      const nw = Math.max(1, img.naturalWidth);
      const nh = Math.max(1, img.naturalHeight);
      const scale = Math.min(targetW / nw, targetH / nh);
      const dw = nw * scale;
      const dh = nh * scale;
      const dx = (targetW - dw) / 2;
      const dy = (targetH - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("image"));
    img.src = imageDataUrl;
  });
}

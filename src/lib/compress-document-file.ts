/** ضغط مستمسكات الصور في المتصفح قبل الحفظ على السيرفر */

export type CompressDocumentOptions = {
  /** أكبر ضلع مسموح بالبكسل */
  maxEdge?: number;
  /** جودة JPEG الابتدائية 0–1 */
  quality?: number;
  /** الحجم المستهدف بالبايت (يُخفَّض الجودة تدريجياً إن تجاوزه) */
  targetBytes?: number;
  /** الحد الأقصى النهائي بالبايت */
  hardMaxBytes?: number;
};

const DEFAULTS: Required<CompressDocumentOptions> = {
  maxEdge: 1600,
  quality: 0.78,
  targetBytes: 450 * 1024,
  hardMaxBytes: 900 * 1024,
};

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(file.name);
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('تعذر قراءة الصورة للضغط'));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function buildOutputName(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, '') || 'document';
  return `${base}.jpg`;
}

/**
 * يضغط الصور (JPEG/PNG/WEBP/GIF…) إلى JPEG بحجم أصغر.
 * ملفات PDF تُعاد كما هي دون تعديل.
 */
export async function compressDocumentFile(
  file: File,
  options?: CompressDocumentOptions
): Promise<File> {
  if (!file || file.size <= 0) return file;
  if (isPdfFile(file) || !isImageFile(file)) return file;

  // صور صغيرة جداً لا تحتاج ضغطاً إضافياً
  if (file.size <= 180 * 1024 && /^image\/jpe?g$/i.test(file.type)) {
    return file;
  }

  const opts = { ...DEFAULTS, ...options };

  let img: HTMLImageElement;
  try {
    img = await loadImageElement(file);
  } catch {
    return file;
  }

  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) return file;

  let scale = Math.min(1, opts.maxEdge / Math.max(srcW, srcH));
  let width = Math.max(1, Math.round(srcW * scale));
  let height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;

  const qualities = [opts.quality, 0.7, 0.62, 0.55, 0.48];
  let bestBlob: Blob | null = null;

  for (let pass = 0; pass < 3; pass++) {
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    for (const q of qualities) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', q);
      if (!blob) continue;
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= opts.targetBytes) {
        bestBlob = blob;
        break;
      }
    }

    if (bestBlob && bestBlob.size <= opts.targetBytes) break;
    if (bestBlob && bestBlob.size <= opts.hardMaxBytes && pass >= 1) break;

    // تصغير إضافي مع الحفاظ على النسبة
    const nw = Math.round(width * 0.82);
    const nh = Math.round(height * 0.82);
    if (Math.max(nw, nh) < 640) break;
    width = nw;
    height = nh;
  }

  if (!bestBlob) return file;

  // إن كان الناتج أكبر من الأصل نُبقي الأصل (إلا PNG/WEBP الكبيرة حيث JPEG أوفر غالباً)
  const preferCompressed =
    bestBlob.size < file.size ||
    !/^image\/jpe?g$/i.test(file.type);

  if (!preferCompressed) return file;

  // إذا ما زال أكبر من الحد النهائي وبقي الأصل أصغر — أبقِ الأصل
  if (bestBlob.size > opts.hardMaxBytes && file.size <= opts.hardMaxBytes) {
    return file;
  }

  return new File([bestBlob], buildOutputName(file.name), {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

/** ضغط مخصّص للصورة الشخصية (أبعاد أصغر) */
export async function compressPersonalPhoto(file: File): Promise<File> {
  return compressDocumentFile(file, {
    maxEdge: 1100,
    quality: 0.8,
    targetBytes: 280 * 1024,
    hardMaxBytes: 500 * 1024,
  });
}

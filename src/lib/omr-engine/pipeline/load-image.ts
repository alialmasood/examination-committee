import sharp from "sharp";
export type LoadedImage = {
  buffer: Buffer;
  format?: string;
  width?: number;
  height?: number;
};

const SUPPORTED = new Set(["jpeg", "jpg", "png", "webp", "tif", "tiff", "gif", "avif"]);

export async function loadImage(input: Buffer): Promise<LoadedImage> {
  const meta = await sharp(input).metadata();
  const fmt = (meta.format || "").toLowerCase();
  if (!SUPPORTED.has(fmt)) {
    throw new Error(`Unsupported image format: ${meta.format || "unknown"}`);
  }
  return {
    buffer: input,
    format: meta.format,
    width: meta.width,
    height: meta.height,
  };
}

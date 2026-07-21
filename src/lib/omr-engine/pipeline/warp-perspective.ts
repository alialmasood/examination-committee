import sharp from "sharp";
import type { DebugCollector } from "../debug";
import type { Raster, SheetBounds } from "../types";

/**
 * قص مستطيل الحدود (بدون homography كامل حتى تتوفر زوايا دقيقة من كشف كنتور).
 * يُسمّى «warp» لأن الخطوة التالية في الأنابيب ستكون resize إلى مرجع ثابت.
 */
export async function warpPerspective(
  raster: Raster,
  bounds: SheetBounds,
  debug: DebugCollector
): Promise<Raster> {
  const { x0, y0, x1, y1 } = bounds.bbox;
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const width = Math.min(raster.width - left, Math.ceil(x1 - x0) + 1);
  const height = Math.min(raster.height - top, Math.ceil(y1 - y0) + 1);
  if (width < 8 || height < 8) {
    throw new Error("Detected sheet bounds too small.");
  }

  const ch = raster.channels >= 3 ? 3 : 1;
  const { data, info } = await sharp(Buffer.from(raster.data), {
    raw: { width: raster.width, height: raster.height, channels: ch },
  })
    .extract({ left, top, width, height })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out: Raster = {
    data: data as Buffer,
    width: info.width,
    height: info.height,
    channels: info.channels ?? 1,
  };

  await debug.addRaster("04_warped_crop", out);
  return out;
}

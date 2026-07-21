import sharp from "sharp";
import { OMR_REF_HEIGHT, OMR_REF_WIDTH } from "@/src/lib/correction/omr-sheet-template";
import type { DebugCollector } from "../debug";
import type { Raster } from "../types";

/**
 * تطبيع إلى أبعاد القالب المرجعية (ملء الإطار).
 */
export async function normalizeSheet(cropped: Raster, debug: DebugCollector): Promise<Raster> {
  const { data, info } = await sharp(Buffer.from(cropped.data), {
    raw: { width: cropped.width, height: cropped.height, channels: 1 },
  })
    .resize(OMR_REF_WIDTH, OMR_REF_HEIGHT, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out: Raster = {
    data: data as Buffer,
    width: info.width,
    height: info.height,
    channels: info.channels ?? 1,
  };

  await debug.addRaster("05_normalized_sheet", out);
  return out;
}

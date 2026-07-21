import sharp from "sharp";
import type { DebugCollector } from "../debug";
import type { Raster } from "../types";

/**
 * رمادي + تسوية خلفية + تنعيم خفيف كإزالة ضوضاء أولية.
 */
export async function preprocessImage(loaded: { buffer: Buffer }, debug: DebugCollector): Promise<Raster> {
  let { data, info } = await sharp(loaded.buffer)
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .greyscale()
    .blur(0.35)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let width = info.width;
  let height = info.height;
  let channels = info.channels ?? 1;

  if (width > height) {
    const r90 = await sharp(Buffer.from(data), {
      raw: { width, height, channels: 1 },
    })
      .rotate(90)
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = r90.data as Buffer;
    width = r90.info.width;
    height = r90.info.height;
    channels = r90.info.channels ?? 1;
  }

  const raster: Raster = {
    data: data as Buffer,
    width,
    height,
    channels,
  };

  await debug.addRaster("01_grayscale", raster);

  const thPng = await sharp(Buffer.from(raster.data), {
    raw: { width: raster.width, height: raster.height, channels: 1 },
  })
    .threshold(210)
    .png()
    .toBuffer();
  await debug.addPngBuffer("02_threshold", thPng);

  return raster;
}

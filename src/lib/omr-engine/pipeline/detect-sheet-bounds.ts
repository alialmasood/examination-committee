import sharp from "sharp";
import { findContentBBox } from "@/src/lib/correction/services/sheet-geometry";
import type { DebugCollector } from "../debug";
import type { Raster, SheetBounds } from "../types";

function bboxToCorners(bbox: SheetBounds["bbox"]): SheetBounds["corners"] {
  const { x0, y0, x1, y1 } = bbox;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** تراكب مستطيل الاكتشاف على PNG رمادي */
async function renderContourDebug(raster: Raster, bbox: SheetBounds["bbox"]): Promise<Buffer> {
  const { width: w, height: h } = raster;
  const base = await sharp(Buffer.from(raster.data), {
    raw: { width: w, height: h, channels: 1 },
  })
    .png()
    .toBuffer();

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${bbox.x0}" y="${bbox.y0}" width="${bbox.x1 - bbox.x0}" height="${bbox.y1 - bbox.y0}"
      fill="none" stroke="rgb(220,38,38)" stroke-width="4"/>
  </svg>`;

  return sharp(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

export async function detectSheetBounds(
  raster: Raster,
  options: { skipAutoBBox?: boolean },
  debug: DebugCollector
): Promise<SheetBounds> {
  let bbox: SheetBounds["bbox"];
  if (options.skipAutoBBox) {
    bbox = { x0: 0, y0: 0, x1: raster.width - 1, y1: raster.height - 1 };
  } else {
    bbox = findContentBBox(raster.data, raster.width, raster.height, raster.channels);
  }

  const contourPng = await renderContourDebug(raster, bbox);
  await debug.addPngBuffer("03_detected_contour", contourPng);

  return { bbox, corners: bboxToCorners(bbox) };
}

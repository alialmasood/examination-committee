/**
 * المرحلة 1: تطبيع صورة الشيت إلى مرجع A4 ثابت (رمادي، إزالة ضوضاء خفيفة، حدود، resize).
 * تصحيح المنظور: غير مفعّل هنا (يتطلب علامات ركن أو تقدير هوموغرافي لاحقًا).
 */

import sharp from "sharp";
import { OMR_REF_HEIGHT, OMR_REF_WIDTH } from "../omr-sheet-template";
import { adaptiveThresholdGray } from "./adaptive-threshold";
import { findContentBBox, type BBox } from "./sheet-geometry";
import type { NormalizeSheetMeta } from "./types";

export const CORRECTION_PIPELINE_VERSION = "2.0.0";

async function ensurePortraitA4(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): Promise<{ data: Buffer; width: number; height: number; corrected: boolean }> {
  if (width <= height) {
    return { data, width, height, corrected: false };
  }
  const rawChannels = channels >= 3 ? 3 : 1;
  const { data: out, info } = await sharp(Buffer.from(data), {
    raw: { width, height, channels: rawChannels },
  })
    .rotate(90)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: out as Buffer,
    width: info.width,
    height: info.height,
    corrected: true,
  };
}

async function rasterizeCanonical(
  input: Buffer,
  targetWidth: number,
  targetHeight: number,
  blurKernel: number
): Promise<{
  data: Buffer;
  width: number;
  height: number;
  channels: number;
  pipeline: "trim-fill" | "contain-fallback";
}> {
  const bk = Number.isFinite(blurKernel) && blurKernel >= 0 ? blurKernel : 0.35;
  const base = sharp(input)
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .greyscale()
    .blur(bk);

  const runTrimFill = async () => {
    const { data, info } = await base
      .clone()
      .trim({ threshold: 14 })
      .resize(targetWidth, targetHeight, {
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels ?? 1;
    return {
      data: data as Buffer,
      width: info.width,
      height: info.height,
      channels,
      pipeline: "trim-fill" as const,
    };
  };

  try {
    return await runTrimFill();
  } catch {
    const { data, info } = await base
      .clone()
      .resize(targetWidth, targetHeight, {
        fit: "contain",
        position: "centre",
        kernel: sharp.kernel.lanczos3,
        background: { r: 255, g: 255, b: 255 },
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels ?? 1;
    return {
      data: data as Buffer,
      width: info.width,
      height: info.height,
      channels,
      pipeline: "contain-fallback" as const,
    };
  }
}

export type NormalizedRaster = {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
  meta: NormalizeSheetMeta;
  /** ثنائية اختيارية (0 حبر / 255 ورقة) بعد adaptive threshold — قناة واحدة بنفس أبعاد data */
  binaryData?: Buffer;
};

/** معاملات تمهيد من قالب المعايرة (أبعاد الصفحة المرجعية + ضبط صورة) */
export type NormalizeTemplatePreprocess = {
  pageWidth: number;
  pageHeight: number;
  blurKernel: number;
  adaptiveThresholdBlockSize: number;
  adaptiveThresholdC: number;
};

export type NormalizeOptions = {
  /** استخدام كامل الإطار كمحتوى (مكافئ تعطيل اقتصاص الحدود) */
  forceFullContentBBox?: boolean;
  /** عند تمريره تُستخدم أبعاد الصفحة و blur من القالب؛ adaptive اختياري */
  templatePreprocess?: NormalizeTemplatePreprocess;
};

/**
 * يُرجع مصفوفة بكسل جاهزة لمرحلة الاستخراج (أبعاد ثابتة تقريبًا A4 رأسي).
 */
export async function normalizeSheetImageForCorrection(
  input: Buffer,
  options?: NormalizeOptions
): Promise<NormalizedRaster> {
  const tp = options?.templatePreprocess;
  const targetW = tp?.pageWidth && tp.pageWidth > 16 ? Math.round(tp.pageWidth) : OMR_REF_WIDTH;
  const targetH = tp?.pageHeight && tp.pageHeight > 16 ? Math.round(tp.pageHeight) : OMR_REF_HEIGHT;
  const blurK = tp?.blurKernel ?? 0.35;

  let { data, width, height, channels, pipeline } = await rasterizeCanonical(input, targetW, targetH, blurK);
  const portrait = await ensurePortraitA4(data, width, height, channels);
  data = portrait.data;
  width = portrait.width;
  height = portrait.height;
  const portraitCorrected = portrait.corrected;

  /** deskew: يُترك 0 حتى يُربط لاحقًا بمكتبة منظور/علامات ركن دون تغيير أبعاد المرجع */
  const deskewDegrees = 0;

  let bbox: BBox =
    options?.forceFullContentBBox || pipeline === "trim-fill"
      ? { x0: 0, y0: 0, x1: width - 1, y1: height - 1 }
      : findContentBBox(data, width, height, channels);
  const bw = bbox.x1 - bbox.x0;
  const bh = bbox.y1 - bbox.y0;
  if (pipeline === "contain-fallback" && bw * bh < width * height * 0.2) {
    bbox = { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
  }

  let binaryData: Buffer | undefined;
  const bs = tp?.adaptiveThresholdBlockSize ?? 0;
  const cTh = tp?.adaptiveThresholdC ?? 7;
  if (channels === 1 && bs >= 3) {
    binaryData = adaptiveThresholdGray(data, width, height, bs, cTh);
  }

  return {
    data,
    width,
    height,
    channels,
    binaryData,
    meta: {
      pipelineVersion: CORRECTION_PIPELINE_VERSION,
      width,
      height,
      channels,
      rasterPipeline: pipeline,
      portraitCorrected,
      deskewDegrees,
      perspectiveCorrected: false,
      contentBBox: bbox,
    },
  };
}

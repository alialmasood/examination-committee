import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { OmrEngineDebugOptions } from "./types";
import type { Raster } from "./types";

export type DebugCollector = {
  enabled: boolean;
  outputDir: string | null;
  base64InResult: boolean;
  images: string[];
  addPngBuffer: (label: string, png: Buffer) => Promise<void>;
  addRaster: (label: string, raster: Raster) => Promise<void>;
};

function isDebugEnabled(
  debug?: boolean | OmrEngineDebugOptions
): debug is boolean | OmrEngineDebugOptions {
  return debug === true || (typeof debug === "object" && debug != null);
}

export function createDebugCollector(debug?: boolean | OmrEngineDebugOptions): DebugCollector {
  const enabled = isDebugEnabled(debug);
  const opt = typeof debug === "object" && debug != null ? debug : {};
  let outputDir =
    typeof opt.outputDir === "string" && opt.outputDir.trim() ? path.resolve(opt.outputDir.trim()) : null;
  if (debug === true && !outputDir) {
    outputDir = path.join(os.tmpdir(), "omr-engine-debug", String(Date.now()));
  }
  const base64InResult = Boolean(opt.base64InResult);

  const images: string[] = [];

  const addPngBuffer = async (label: string, png: Buffer) => {
    if (!enabled) return;
    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true });
      const safe = label.replace(/[^a-zA-Z0-9_-]+/g, "_");
      const fp = path.join(outputDir, `${safe}.png`);
      await fs.promises.writeFile(fp, png);
      images.push(fp);
    }
    if (base64InResult) {
      images.push(`data:image/png;base64,${png.toString("base64")}`);
    }
  };

  const addRaster = async (label: string, raster: Raster) => {
    if (!enabled) return;
    const ch = raster.channels >= 3 ? 3 : 1;
    const png = await sharp(Buffer.from(raster.data), {
      raw: { width: raster.width, height: raster.height, channels: ch },
    })
      .png()
      .toBuffer();
    await addPngBuffer(label, png);
  };

  return {
    enabled,
    outputDir,
    base64InResult,
    images,
    addPngBuffer,
    addRaster,
  };
}

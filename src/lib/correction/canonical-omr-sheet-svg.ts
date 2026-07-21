/**
 * شيت OMR «كانونيكال» بصيغة SVG — نفس أبعاد template_config ونفس مراكز الفقاعات
 * التي تُستخدم في المعايرة والتصحيح (بدون الاعتماد على ملف صورة/PDF مرفوع).
 */

import type { PythonTemplateGeometry } from "@/src/lib/correction/python-template-config-sync";
import { buildAnswerBubbleFlatPointsFromGeometry } from "@/src/lib/correction/python-template-config-sync";

function previewGlobalAnswerShift(templateCode: string, answerRowStep: number): { nx: number; ny: number } {
  const code = String(templateCode || "").trim().toUpperCase();
  if (code === "OMR_100") {
    return { nx: 0, ny: -(answerRowStep * 6.0) };
  }
  return { nx: 0, ny: 0 };
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildCanonicalOmSheetSvgString(opts: {
  templateCode: string;
  geom: PythonTemplateGeometry;
  /** data:image/png;base64,... — شعار الكلية (اختياري) */
  logoPngDataUrl?: string;
}): string {
  const { templateCode, geom, logoPngDataUrl } = opts;
  const W = Math.max(1, geom.pageWidth);
  const H = Math.max(1, geom.pageHeight);
  const minSide = Math.min(W, H);
  const bubbleR = Math.max(3, geom.bubbleRadiusNorm * minSide);
  const strokeMain = Math.max(1.2, minSide * 0.0011);
  const strokeThin = Math.max(1, minSide * 0.00075);

  const flat = buildAnswerBubbleFlatPointsFromGeometry(geom);
  const shift = previewGlobalAnswerShift(templateCode, geom.answerRowStep);
  const answers = flat.map((p) => ({ nx: p.nx + shift.nx, ny: p.ny + shift.ny }));

  const nQ = Math.max(1, Math.min(100, geom.totalQuestions));

  const circles: string[] = [];
  for (const p of answers) {
    const cx = p.nx * W;
    const cy = p.ny * H;
    circles.push(
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${bubbleR.toFixed(2)}" fill="none" stroke="#111827" stroke-width="${strokeThin.toFixed(3)}"/>`
    );
  }

  const letters = ["A", "B", "C", "D"];
  const labelSize = Math.max(9, Math.round(minSide * 0.009));
  for (let q = 1; q <= nQ; q++) {
    const base = (q - 1) * 4;
    for (let j = 0; j < 4; j++) {
      const p = answers[base + j];
      if (!p) continue;
      const cx = p.nx * W;
      const cy = p.ny * H + bubbleR * 0.85;
      circles.push(
        `<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${labelSize}" fill="#111827" font-weight="600">${letters[j]}</text>`
      );
    }
  }

  const qNumSize = Math.max(10, Math.round(minSide * 0.0105));
  for (let q = 1; q <= nQ; q++) {
    const p0 = answers[(q - 1) * 4];
    if (!p0) continue;
    const cx = p0.nx * W - bubbleR * 2.65;
    const cy = p0.ny * H + qNumSize * 0.35;
    circles.push(
      `<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="${qNumSize}" fill="#111827" font-weight="700">${q}</text>`
    );
  }

  const hdrFs = Math.round(minSide * 0.011);
  const metaFs = Math.round(minSide * 0.0095);
  const instrFs = Math.round(minSide * 0.0078);
  const footFs = Math.round(minSide * 0.0085);

  const ministryBlock = `
  <foreignObject x="${(0.05 * W).toFixed(1)}" y="${(0.045 * H).toFixed(1)}" width="${(0.42 * W).toFixed(1)}" height="${(0.18 * H).toFixed(1)}">
    <div xmlns="http://www.w3.org/1999/xhtml" dir="rtl" style="font-family:Cairo,'Segoe UI',Tahoma,sans-serif;font-size:${hdrFs}px;line-height:1.38;color:#111827;font-weight:700;">
      <div>${escXml("وزارة التعليم العالي والبحث العلمي")}</div>
      <div style="margin-top:0.35em">${escXml("كلية الشرق التقنية التخصصية")}</div>
      <div style="margin-top:0.55em;font-weight:600;font-size:${metaFs}px;">
        <span>${escXml("اسم المادة الامتحانية:")}</span> —<br/>
        <span>${escXml("اسم الطالب:")}</span> —<br/>
        <span>${escXml("القسم:")}</span> —
      </div>
    </div>
  </foreignObject>`;

  const metaRight = `
  <foreignObject x="${(0.53 * W).toFixed(1)}" y="${(0.052 * H).toFixed(1)}" width="${(0.42 * W).toFixed(1)}" height="${(0.16 * H).toFixed(1)}">
    <div xmlns="http://www.w3.org/1999/xhtml" dir="rtl" style="font-family:Cairo,'Segoe UI',Tahoma,sans-serif;font-size:${metaFs}px;line-height:1.42;color:#111827;font-weight:600;">
      <div><strong>${escXml("المرحلة:")}</strong></div>
      <div style="margin-top:0.35em"><strong>${escXml("تاريخ الامتحان:")}</strong></div>
      <div style="margin-top:0.35em"><strong>${escXml("كود الطالب:")}</strong></div>
      <div style="margin-top:0.55em;font-weight:700">${escXml("الامتحانات النهائية 2025-2026")}</div>
    </div>
  </foreignObject>`;

  const footerBlock = `
  <foreignObject x="${(0.05 * W).toFixed(1)}" y="${(0.935 * H).toFixed(1)}" width="${(0.9 * W).toFixed(1)}" height="${(0.055 * H).toFixed(1)}">
    <div xmlns="http://www.w3.org/1999/xhtml" dir="rtl" style="font-family:Cairo,'Segoe UI',Tahoma,sans-serif;font-size:${footFs}px;display:flex;justify-content:space-between;color:#111827;font-weight:600;">
      <span style="flex:1;text-align:right">${escXml("اسم وتوقيع مشرف القاعة")}</span>
      <span style="flex:1;text-align:center">${escXml("ختم الكلية")}</span>
      <span style="flex:1;text-align:left">${escXml("اسم وتوقيع مراقب القاعة")}</span>
    </div>
  </foreignObject>`;

  /** بين كتلة الوزارة (حتى ~47% العرض) وكتلة اليمين (~53%) — شعار دائري في المنتصف */
  const clipId = `college-logo-clip-${templateCode.replace(/[^A-Z0-9]/gi, "")}`;
  const logoD = Math.min(W * 0.054, (0.215 * H) * 0.62, minSide * 0.11);
  const logoCx = W / 2;
  const logoCy = 0.028 * H + (0.215 * H) * 0.44;
  const logoFrag =
    logoPngDataUrl && logoPngDataUrl.startsWith("data:image/png")
      ? `
  <defs>
    <clipPath id="${clipId}">
      <circle cx="${logoCx.toFixed(2)}" cy="${logoCy.toFixed(2)}" r="${(logoD / 2).toFixed(2)}"/>
    </clipPath>
  </defs>
  <image
    href="${logoPngDataUrl}"
    x="${(logoCx - logoD / 2).toFixed(2)}"
    y="${(logoCy - logoD / 2).toFixed(2)}"
    width="${logoD.toFixed(2)}"
    height="${logoD.toFixed(2)}"
    clip-path="url(#${clipId})"
    preserveAspectRatio="xMidYMid slice"
  />`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="${(0.028 * W).toFixed(1)}" y="${(0.028 * H).toFixed(1)}" width="${(0.944 * W).toFixed(1)}" height="${(0.215 * H).toFixed(1)}" fill="none" stroke="#111827" stroke-width="${strokeMain.toFixed(2)}"/>
  ${logoFrag}
  ${ministryBlock}
  ${metaRight}
  <text x="${(W / 2).toFixed(1)}" y="${(0.272 * H).toFixed(1)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${instrFs}" fill="#111827">
    For each answer, please fill in marks like this: ● not like this: ✖ ⊘ ✔
  </text>
  <text x="${(0.055 * W).toFixed(1)}" y="${(geom.answerGridTopNy * H - minSide * 0.018).toFixed(1)}" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(instrFs * 1.05)}" fill="#111827" font-weight="700">Q 1:</text>
  ${circles.join("\n  ")}
  <line x1="${(0.05 * W).toFixed(1)}" y1="${(0.918 * H).toFixed(1)}" x2="${(0.95 * W).toFixed(1)}" y2="${(0.918 * H).toFixed(1)}" stroke="#111827" stroke-width="${strokeMain.toFixed(2)}"/>
  ${footerBlock}
</svg>`;
}

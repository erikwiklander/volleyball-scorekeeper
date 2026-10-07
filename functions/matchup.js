import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { escapeHtml, validMetadata } from './preview.js';
process.env.FONTCONFIG_FILE = fileURLToPath(
  new URL('./fonts/fonts.conf', import.meta.url),
);
const fontfile = fileURLToPath(new URL('./fonts/Inter.ttf', import.meta.url));
sharp.cache(false);
sharp.concurrency(1);
function color(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : fallback;
}
function logoBuffer(value) {
  if (typeof value !== 'string' || value.length > 1_500_000) return;
  const match = value.match(
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/,
  );
  return match ? Buffer.from(match[2], 'base64') : undefined;
}
async function label(text, width, size, foreground, maxHeight = 100) {
  let rendered;
  for (let fontSize = size; fontSize >= 16; fontSize -= 2) {
    rendered = await sharp({
      text: {
        text: `<span foreground="${foreground}">${escapeHtml(text)}</span>`,
        font: `Inter Semi-Bold ${fontSize}`,
        fontfile,
        width,
        align: 'center',
        dpi: 72,
        rgba: true,
        wrap: 'word-char',
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (rendered.info.height <= maxHeight) return rendered;
  }
  return rendered;
}
export async function prepareMatchup(metadata) {
  if (!validMetadata(metadata)) return metadata;
  const home = logoBuffer(metadata.homeLogo),
    away = logoBuffer(metadata.awayLogo);
  if (!home || !away) return metadata;
  try {
    const logos = [];
    for (const buffer of [home, away]) {
      const image = sharp(buffer, {
        limitInputPixels: 262_144,
        failOn: 'warning',
      });
      const info = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(info.format)) return metadata;
      logos.push(
        await image
          .resize(220, 220, { fit: 'contain', background: '#ffffff' })
          .png()
          .toBuffer(),
      );
    }
    const homeColor = color(metadata.homeColor, '#226a9e');
    const awayColor = color(metadata.awayColor, '#b94c35');
    const background =
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
      <rect width="1200" height="630" fill="#f6f5ef"/>
      <rect width="1200" height="110" fill="#102d27"/>
      <circle cx="65" cy="55" r="9" fill="#d8f59b"/>
      <rect x="196" y="155" width="260" height="250" rx="24" fill="white"/>
      <rect x="744" y="155" width="260" height="250" rx="24" fill="white"/>
      <rect x="196" y="155" width="260" height="8" rx="4" fill="${homeColor}"/>
      <rect x="744" y="155" width="260" height="8" rx="4" fill="${awayColor}"/>
      <circle cx="600" cy="283" r="45" fill="white" stroke="#dce2d9" stroke-width="2"/>
      <path d="M56 561H1144" stroke="#dce2d9" stroke-width="2"/>
    </svg>`);
    const layers = [
      { input: logos[0], left: 216, top: 174 },
      { input: logos[1], left: 764, top: 174 },
    ];
    for (const [text, width, size, foreground, center, top, maxHeight] of [
      ['LIVE SCORE', 220, 26, '#f6f5ef', 212, 40, 40],
      ['VS', 80, 27, '#64746c', 600, 266, 40],
      [metadata.home, 450, 44, '#102d27', 326, 446, 92],
      [metadata.away, 450, 44, '#102d27', 874, 446, 92],
      ['SCOREKEEPER', 200, 19, '#64746c', 156, 586, 30],
    ]) {
      const rendered = await label(text, width, size, foreground, maxHeight);
      layers.push({
        input: rendered.data,
        left: Math.round(center - rendered.info.width / 2),
        top,
      });
    }
    const image = await sharp(background).composite(layers).png().toBuffer();
    const imageVersion = createHash('sha256')
      .update(image)
      .digest('hex')
      .slice(0, 16);
    return { ...metadata, image, imageVersion };
  } catch {
    // A missing or unreadable logo must never prevent a compact preview.
    return metadata;
  }
}

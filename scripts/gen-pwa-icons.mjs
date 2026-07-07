// Gera os icones PWA (192/512/maskable/apple) a partir do logo, com fundo branco.
// Uso: node scripts/gen-pwa-icons.mjs
import sharp from "sharp";
import { existsSync } from "node:fs";

const src = existsSync("public/logo-newshop.jpg")
  ? "public/logo-newshop.jpg"
  : "public/newshop-logo.jpg";

const bg = { r: 255, g: 255, b: 255, alpha: 1 };

async function gen(size, out, padding) {
  const inner = Math.round(size * (1 - padding * 2));
  const logo = await sharp(src).resize(inner, inner, { fit: "contain", background: bg }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toFile(out);
  console.log("gerado", out);
}

await gen(192, "public/pwa-192.png", 0.08);
await gen(512, "public/pwa-512.png", 0.08);
await gen(512, "public/pwa-maskable-512.png", 0.18);
await gen(180, "public/apple-touch-icon.png", 0.08);
console.log("ok");

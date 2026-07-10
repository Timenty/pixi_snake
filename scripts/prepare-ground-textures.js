/**
 * Подготовка текстур земли из исходных 4K-паков (sharp).
 * Запускать после смены исходников: node scripts/prepare-ground-textures.js
 *
 * Делает для песка (Stylized_Sand_001):
 *  - sand_color.jpg  = basecolor × ambientOcclusion (AO запечён — трещины
 *                      глубже без лишнего сэмпла в рантайме), 1024, q88
 *  - sand_normal.jpg = карта нормалей, 1024, q90 (для попиксельного света)
 *  - sand_rough.jpg  = roughness, 1024, q80 (модуляция мокрого блика)
 *
 * Все ресайзы — с бесшовным заворотом краёв (extend+wrap перед resize),
 * иначе бикубик у кромки тайла ломает бесшовность и на стыках видны линии.
 */
const sharp = require("sharp");
const path = require("path");

const SRC = path.join(__dirname, "../src/assets/background/Stylized_Sand_001/Stylized_Sand_001_4K");
const OUT = path.join(__dirname, "../src/assets/background");
const SIZE = 1024;

// Ресайз бесшовного тайла: тайлим 3×3 и режем центр — края сэмплируются
// с заворотом, как на GPU при REPEAT, кромка не портится.
async function resizeSeamless(input, size) {
    const img = sharp(input);
    const meta = await img.metadata();
    const buf = await img.removeAlpha().raw().toBuffer();
    const w = meta.width;
    const h = meta.height;
    const tiled = await sharp(buf, { raw: { width: w, height: h, channels: 3 } })
        .extend({
            top: 256, bottom: 256, left: 256, right: 256,
            extendWith: "repeat", // заворот противоположного края
        })
        .toBuffer({ resolveWithObject: true });
    // масштаб с учётом полей: центр (w×h) должен стать size×size
    const scale = size / w;
    const padScaled = Math.round(256 * scale);
    return sharp(tiled.data, {
        raw: { width: w + 512, height: h + 512, channels: 3 },
    })
        .resize(Math.round((w + 512) * scale), Math.round((h + 512) * scale), {
            kernel: "lanczos3",
        })
        .extract({ left: padScaled, top: padScaled, width: size, height: size });
}

async function main() {
    // 1) Цвет с запечённым AO: multiply в linear-пространстве sharp-композитом.
    const color = await resizeSeamless(path.join(SRC, "Stylized_Sand_001_basecolor.png"), SIZE);
    const ao = await (await resizeSeamless(path.join(SRC, "Stylized_Sand_001_ambientOcclusion.png"), SIZE))
        .jpeg({ quality: 100 })
        .toBuffer();
    await color
        .composite([{ input: ao, blend: "multiply" }])
        .jpeg({ quality: 88 })
        .toFile(path.join(OUT, "sand_color.jpg"));
    console.log("sand_color.jpg (basecolor × AO)");

    // 2) Нормаль: качество повыше — артефакты JPEG на нормалях заметнее.
    await (await resizeSeamless(path.join(SRC, "Stylized_Sand_001_normal.png"), SIZE))
        .jpeg({ quality: 90 })
        .toFile(path.join(OUT, "sand_normal.jpg"));
    console.log("sand_normal.jpg");

    // 3) Roughness — одноканальная по сути, JPEG q80 достаточно.
    await (await resizeSeamless(path.join(SRC, "Stylized_Sand_001_roughness.png"), SIZE))
        .jpeg({ quality: 80 })
        .toFile(path.join(OUT, "sand_rough.jpg"));
    console.log("sand_rough.jpg");

    const fs = require("fs");
    for (const f of ["sand_color.jpg", "sand_normal.jpg", "sand_rough.jpg"]) {
        const kb = Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
        console.log(`  ${f}: ${kb} KB`);
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});

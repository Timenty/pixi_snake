import * as PIXI from "pixi.js";

export type SkinPattern = "spots" | "stripes" | "zigzag" | "diamonds" | "hearts" | "none";

export interface SkinOptions {
    bodyColor: string; // css hex, напр. "#e321b0"
    patternColor: string;
    pattern: SkinPattern;
    density: number; // 1..10 — частота узора
    seed: number; // фиксирует раскладку пятен: смена цвета не перемешивает узор
}

export interface SkinTextures {
    head: PIXI.Texture;
    body: PIXI.Texture; // power-of-two, wrapMode REPEAT — тайлится вдоль тела
}

export const DEFAULT_SKIN: SkinOptions = {
    bodyColor: "#e321b0",
    patternColor: "#ff9b2f",
    pattern: "spots",
    density: 5,
    seed: 1,
};

// Тайл тела обязан быть power-of-two: REPEAT в WebGL1 работает только на таких.
const BODY_W = 256;
const BODY_H = 128;
const HEAD_W = 144; // длиннее ширины тела → вытянутая мордочка
const HEAD_H = BODY_H;

// Детерминированный PRNG: один seed — одна и та же раскладка узора.
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Вертикальное «объёмное» затенение: тёмные бока, светлая спина по центру.
function shade(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(0,0,0,0.35)");
    g.addColorStop(0.25, "rgba(0,0,0,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.18)");
    g.addColorStop(0.75, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
}

// Узор на тайле. Каждую фигуру рисуем трижды (x, x−W, x+W) —
// горизонтальный шов исчезает, тайл бесшовный.
function drawPattern(
    ctx: CanvasRenderingContext2D,
    opts: SkinOptions,
    W: number,
    H: number
): void {
    const rng = mulberry32(opts.seed);
    ctx.fillStyle = opts.patternColor;
    ctx.strokeStyle = opts.patternColor;

    switch (opts.pattern) {
        case "spots": {
            const count = 6 + Math.round(opts.density * 2.5);
            for (let i = 0; i < count; i++) {
                const cx = rng() * W;
                const cy = 18 + rng() * (H - 36);
                const r = 7 + rng() * 13;
                const rot = rng() * Math.PI;
                const squash = 0.6 + rng() * 0.4;
                for (const dx of [-W, 0, W]) {
                    ctx.beginPath();
                    ctx.ellipse(cx + dx, cy, r, r * squash, rot, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            break;
        }
        case "stripes": {
            // Поперечные кольца: период — целая доля ширины тайла → бесшовно.
            const n = Math.max(2, Math.round(opts.density));
            const period = W / n;
            const band = period * 0.35;
            for (let i = 0; i < n; i++) {
                ctx.fillRect(i * period, 0, band, H);
            }
            break;
        }
        case "zigzag": {
            const n = Math.max(1, Math.round(opts.density / 2));
            const period = W / n;
            const amp = H * 0.22;
            ctx.lineWidth = 9;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.beginPath();
            // Начинаем за левым краем и ведём за правый — линия непрерывна через шов.
            let up = true;
            for (let x = -period / 2; x <= W + period / 2; x += period / 2) {
                const y = H / 2 + (up ? -amp : amp);
                if (x === -period / 2) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
                up = !up;
            }
            ctx.stroke();
            break;
        }
        case "diamonds": {
            const n = Math.max(2, Math.round(opts.density));
            const step = W / n;
            const half = Math.min(step * 0.32, H * 0.28);
            ctx.lineWidth = 6;
            ctx.lineJoin = "round";
            for (let row = 0; row < 2; row++) {
                const cy = row === 0 ? H * 0.32 : H * 0.68;
                const shift = row === 0 ? 0 : step / 2;
                for (let i = 0; i < n; i++) {
                    const cx = i * step + shift;
                    for (const dx of [-W, 0, W]) {
                        ctx.beginPath();
                        ctx.moveTo(cx + dx, cy - half);
                        ctx.lineTo(cx + dx + half, cy);
                        ctx.lineTo(cx + dx, cy + half);
                        ctx.lineTo(cx + dx - half, cy);
                        ctx.closePath();
                        ctx.stroke();
                    }
                }
            }
            break;
        }
        case "hearts": {
            // Один ряд крупных сердец по хребту: только большой размер
            // читается как «сердечко» на игровом зуме (~0.25), мелочь — просто пятна.
            const n = Math.max(2, Math.round(opts.density / 2));
            const step = W / n;
            const size = Math.min(step * 0.55, 62);
            for (let i = 0; i < n; i++) {
                const cx = i * step + step / 2 + (rng() - 0.5) * step * 0.15;
                const cy = H / 2 + (rng() - 0.5) * 12;
                const rot = (rng() - 0.5) * 0.5;
                const s = size * (0.9 + rng() * 0.2);
                for (const dx of [-W, 0, W]) {
                    drawHeart(ctx, cx + dx, cy, s, rot);
                }
            }
            break;
        }
        case "none":
            break;
    }
}

// Сердечко остриём вниз: две круглые дольки + треугольник к острию.
// Такая форма (в отличие от bezier) не разваливается на мелких размерах.
function drawHeart(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    rot: number
): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    const s = size;
    ctx.beginPath();
    ctx.arc(-0.26 * s, -0.15 * s, 0.3 * s, 0, Math.PI * 2);
    ctx.arc(0.26 * s, -0.15 * s, 0.3 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-0.535 * s, -0.03 * s);
    ctx.lineTo(0.535 * s, -0.03 * s);
    ctx.lineTo(0, 0.52 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function makeBodyTexture(opts: SkinOptions): PIXI.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = BODY_W;
    canvas.height = BODY_H;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = opts.bodyColor;
    ctx.fillRect(0, 0, BODY_W, BODY_H);
    drawPattern(ctx, opts, BODY_W, BODY_H);
    shade(ctx, BODY_W, BODY_H); // затенение поверх узора — узор «вживлён» в кожу

    const tex = PIXI.Texture.from(canvas);
    tex.source.style.addressMode = "repeat";
    return tex;
}

// Голова: капсула с носом слева (rope идёт от головы к хвосту, нос — u=0).
// Справа — полная высота, стык прячется под нахлёстом тела.
function makeHeadTexture(opts: SkinOptions): PIXI.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = HEAD_W;
    canvas.height = HEAD_H;
    const ctx = canvas.getContext("2d")!;
    const W = HEAD_W;
    const H = HEAD_H;

    // Капсула: полная высота от стыка (справа) до центра носовой дуги — под этой
    // зоной прячется передний срез тела и не выглядывает. Нос — полуокружность.
    // Нос — половина эллипса, вытянутого вдоль тела (rx > ry) → длинная мордочка.
    const noseRY = H / 2 - 2;
    const noseRX = 88;
    const noseCX = noseRX + 4; // правее этой точки силуэт полной высоты (зона нахлёста)
    ctx.beginPath();
    ctx.moveTo(W, 2);
    ctx.lineTo(noseCX, 2);
    ctx.ellipse(noseCX, H / 2, noseRX, noseRY, 0, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(W, H - 2);
    ctx.closePath();

    ctx.save();
    ctx.clip(); // всё рисуем внутри силуэта головы

    ctx.fillStyle = opts.bodyColor;
    ctx.fillRect(0, 0, W, H);

    // Немного узора на затылке, чтобы голова не была «лысой».
    if (opts.pattern !== "none") {
        const rng = mulberry32(opts.seed + 7);
        ctx.fillStyle = opts.patternColor;
        ctx.globalAlpha = 0.7;
        for (let i = 0; i < 4; i++) {
            const cx = W * 0.55 + rng() * W * 0.4;
            const cy = 20 + rng() * (H - 40);
            const r = 5 + rng() * 8;
            ctx.beginPath();
            ctx.ellipse(cx, cy, r, r * 0.75, rng() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    shade(ctx, W, H);

    // Глаза здесь НЕ рисуем: они живые — Snake.updateFace рисует белки/зрачки
    // поверх головы (следят за едой, моргают). Позиция глаз завязана на
    // пропорции этой текстуры: ~u=0.36 по длине, ±0.2H от хребта.
    // Ноздри у носа.
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    for (const cy of [H * 0.42, H * 0.58]) {
        ctx.beginPath();
        ctx.arc(10, cy, 2.2, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();

    return PIXI.Texture.from(canvas);
}

export function generateSkin(opts: SkinOptions): SkinTextures {
    return {
        head: makeHeadTexture(opts),
        body: makeBodyTexture(opts),
    };
}

const STORAGE_KEY = "pixi-snake-skin";

export function loadSkinOptions(): SkinOptions {
    let opts = { ...DEFAULT_SKIN };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) opts = { ...opts, ...JSON.parse(raw) };
    } catch (e) {
        /* битый JSON — падаем на дефолт */
    }
    // URL-переопределения для быстрых проб (не сохраняются):
    // ?pattern=hearts&body=ff7bc1&accent=c2185b&density=5
    const q = new URLSearchParams(window.location.search);
    const pattern = q.get("pattern");
    if (pattern) opts.pattern = pattern as SkinPattern;
    const body = q.get("body");
    if (body) opts.bodyColor = body.startsWith("#") ? body : `#${body}`;
    const accent = q.get("accent");
    if (accent) opts.patternColor = accent.startsWith("#") ? accent : `#${accent}`;
    const density = q.get("density");
    if (density) opts.density = Number(density);
    return opts;
}

export function saveSkinOptions(opts: SkinOptions): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
}

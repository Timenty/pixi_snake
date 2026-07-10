import * as PIXI from "pixi.js";

const MAP_SIZE = 1024; // разрешение карты влажности (пятна мягкие, хватает)
const MAX_DARK = 0.5; // предел потемнения почвы (alpha оверлея)
const FADE_PERIOD = 30; // тиков между проходами «высыхания»
const DRY_ERASE = 0.05; // сколько стираем за проход в сухую погоду (~35с до сухого)
// Под дождём тоже понемногу «подсыхает»: равновесие спавна и стирания
// держит покрытие частичным — земля остаётся пятнистой, а не заливается
// ровной пеленой на весь экран.
const RAIN_ERASE = 0.012;

// Мягкое пятно: радиальный градиент, чёрный центр → прозрачный край.
function makeBlobTexture(): PIXI.Texture {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.75)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return PIXI.Texture.from(canvas);
}

/**
 * Локальная влажность почвы. Карта — RenderTexture на весь мир:
 * каждая упавшая капля штампует в неё мягкое пятно (альфа копится и
 * насыщается → темнее предела не станет), а оверлей-спрайт растянут на мир
 * и затемняет траву там, где карта непрозрачна.
 * Высыхание — периодический полный проход с blend ERASE: альфа всей карты
 * умножается на (1-x) → пятна постепенно тают, в сухую погоду быстрее.
 */
export class WetGround {
    public readonly overlay: PIXI.Sprite;
    private map: PIXI.RenderTexture;
    private stamp: PIXI.Sprite;
    private eraser: PIXI.Sprite;
    private fadeT = 0;
    private rainCarry = 0; // дробный остаток виртуальных капель
    private toMapX: number; // мировые координаты → пиксели карты
    private toMapY: number;

    constructor(
        private renderer: PIXI.Renderer,
        private worldWidth: number,
        private worldHeight: number
    ) {
        this.map = PIXI.RenderTexture.create({ width: MAP_SIZE, height: MAP_SIZE });
        this.toMapX = MAP_SIZE / worldWidth;
        this.toMapY = MAP_SIZE / worldHeight;

        this.overlay = new PIXI.Sprite(this.map);
        this.overlay.width = worldWidth;
        this.overlay.height = worldHeight;
        this.overlay.alpha = MAX_DARK;
        this.overlay.interactive = false;

        this.stamp = new PIXI.Sprite(makeBlobTexture());
        this.stamp.anchor.set(0.5);

        this.eraser = new PIXI.Sprite(PIXI.Texture.WHITE);
        this.eraser.width = MAP_SIZE;
        this.eraser.height = MAP_SIZE;
        this.eraser.blendMode = PIXI.BLEND_MODES.ERASE;
    }

    // Карта влажности как текстура — шейдер земли берёт из неё локальный
    // «мокрый блик» (см. GroundLighting.wetMap).
    public get texture(): PIXI.Texture {
        return this.map;
    }

    // Капля упала в (x, y) мира — почва там чуть темнеет.
    public addWet(x: number, y: number): void {
        this.stamp.position.set(x * this.toMapX, y * this.toMapY);
        // Штамп достаточно плотный, чтобы ОДНА капля была видна глазом
        // (потемнение в центре ~0.2 от MAX_DARK), но пятна остаются кляксами.
        // Размер с квадратичным разбросом: мелочь 60px часто, лужи до ~360px редко.
        const px = (60 + Math.pow(Math.random(), 2) * 300) * this.toMapX;
        this.stamp.width = px;
        this.stamp.height = px;
        this.stamp.alpha = 0.55 + Math.random() * 0.25;
        this.renderer.render(this.stamp, this.map, false);
    }

    // «Виртуальный дождь»: пока льёт, мокнет ВСЯ карта, а не только видимая
    // область — уехав в другой край мира, застанешь его уже мокрым.
    // Видимые капли у камеры — чистая косметика, влагу кладёт этот метод.
    // 7.5 штампов/тик при интенсивности 1 ≈ той же плотности, что у видимых
    // капель на экран, но размазанной по миру 9000×9000.
    public rainOverWorld(delta: number, intensity: number): void {
        this.rainCarry += intensity * 7.5 * delta;
        while (this.rainCarry >= 1) {
            this.rainCarry -= 1;
            this.addWet(Math.random() * this.worldWidth, Math.random() * this.worldHeight);
        }
    }

    // drying=true — сухая погода, пятна тают заметно быстрее.
    public update(delta: number, drying: boolean): void {
        this.fadeT += delta;
        if (this.fadeT < FADE_PERIOD) return;
        this.fadeT = 0;
        this.eraser.alpha = drying ? DRY_ERASE : RAIN_ERASE;
        this.renderer.render(this.eraser, this.map, false);
    }
}

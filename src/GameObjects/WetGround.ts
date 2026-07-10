import * as PIXI from "pixi.js";

const MAP_SIZE = 1024; // разрешение карты влажности (пятна мягкие, хватает)
const MAX_DARK = 0.5; // предел потемнения от одной капли (масштаб альфы штампа)
const FADE_PERIOD = 30; // тиков между проходами «высыхания»
const DRY_ADD = 0.012; // возврат светлости за проход в сухую погоду (~20с до сухого)
// Под дождём тоже понемногу «подсыхает»: равновесие спавна и стирания
// держит покрытие частичным — земля остаётся пятнистой, а не заливается
// ровной пеленой на весь экран.
const RAIN_ADD = 0.004;

// Мягкое пятно: радиальный градиент, чёрный центр → прозрачный край.
// Экспорт: тем же штампом пользуется след на песке (SandTrail).
export function makeBlobTexture(): PIXI.Texture {
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
 * Локальная влажность почвы. Карта — RenderTexture «светлости» земли на весь
 * мир: белое = сухо, тёмное = мокро.
 *
 * Все операции — только на батчевых blend-режимах PIXI v8 (normal, add,
 * multiply, screen): режимы вроде 'erase' на прямых render({target}) проходах
 * не применяются (идут через blend-фильтры, которым нужен обычный scene graph).
 *  - капля: чёрный blob с blend 'multiply' → dst *= (1 - alpha), пятно темнеет;
 *  - высыхание: белый квад с blend 'add' → светлость линейно возвращается;
 *  - оверлей: спрайт карты с blend 'multiply' поверх земли — белое не меняет
 *    картинку, тёмные пятна затемняют почву.
 */
export class WetGround {
    public readonly overlay: PIXI.Sprite;
    private map: PIXI.RenderTexture;
    private stamp: PIXI.Sprite;
    private dryQuad: PIXI.Sprite;
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
        this.overlay.blendMode = "multiply";
        this.overlay.eventMode = "none";

        this.stamp = new PIXI.Sprite(makeBlobTexture());
        this.stamp.anchor.set(0.5);
        this.stamp.blendMode = "multiply";

        this.dryQuad = new PIXI.Sprite(PIXI.Texture.WHITE);
        this.dryQuad.width = MAP_SIZE;
        this.dryQuad.height = MAP_SIZE;
        this.dryQuad.blendMode = "add";

        // Старт: полностью сухая (белая) карта. Свежая RenderTexture не
        // обязана быть чистой — заливаем явно обычным блендом.
        this.dryQuad.blendMode = "normal";
        this.dryQuad.alpha = 1;
        this.renderer.render({ container: this.dryQuad, target: this.map, clear: true });
        this.dryQuad.blendMode = "add";
    }

    // Карта влажности как текстура — шейдер земли берёт из неё локальный
    // «мокрый блик»: wet = 1 - r (см. GroundLighting.wetMap).
    public get texture(): PIXI.Texture {
        return this.map;
    }

    // Капля упала в (x, y) мира — почва там чуть темнеет.
    public addWet(x: number, y: number): void {
        this.stamp.position.set(x * this.toMapX, y * this.toMapY);
        // Размер с квадратичным разбросом: мелочь 60px часто, лужи до ~360px редко.
        const px = (60 + Math.pow(Math.random(), 2) * 300) * this.toMapX;
        this.stamp.width = px;
        this.stamp.height = px;
        // multiply: dst *= (1 - a) → затемнение центра ~28-40% за каплю
        this.stamp.alpha = (0.55 + Math.random() * 0.25) * MAX_DARK;
        this.renderer.render({ container: this.stamp, target: this.map, clear: false });
    }

    // «Виртуальный дождь»: пока льёт, мокнет ВСЯ карта, а не только видимая
    // область — уехав в другой край мира, застанешь его уже мокрым.
    // Видимые капли у камеры — чистая косметика, влагу кладёт этот метод.
    // 7.5 штампов/тик при интенсивности 1 ≈ той же плотности, что у видимых
    // капель на экран, но размазанной по миру.
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
        this.dryQuad.alpha = drying ? DRY_ADD : RAIN_ADD;
        this.renderer.render({ container: this.dryQuad, target: this.map, clear: false });
    }
}

import * as PIXI from "pixi.js";
import { makeBlobTexture } from "./WetGround";

const MAP_W = 512; // разрешение карты следа по ширине песка
// Затемнение за один штамп. Точка песка под проползающим телом ловит ~40
// перекрывающихся штампов (сегменты каждые 20px, шаг пути 14px, блоб ~100px) —
// итоговое затемнение (1-a)^40 ≈ 0.75, дальше темнеет только повторными проходами.
const STAMP_ALPHA = 0.007;
const FADE_PERIOD = 30; // тиков между проходами «заметания» следа
const FADE_ADD = 0.006; // возврат светлости за проход (след живёт ~минуту)

/**
 * След змейки на песке. Та же схема, что у WetGround: RenderTexture-карта
 * «светлости» (белое = нетронуто), штампы тёмных пятен с blend multiply,
 * заметание — белый квад с blend add, оверлей multiply поверх земли.
 * Карта покрывает только песчаный биом — на траве следа не остаётся.
 *
 * Штампы кладутся пачкой: все сегменты змейки в один контейнер и ОДИН
 * renderer.render на шаг пути (а не по вызову на сегмент).
 */
export class SandTrail {
    public readonly overlay: PIXI.Sprite;
    private map: PIXI.RenderTexture;
    private stampLayer = new PIXI.Container();
    private pool: PIXI.Sprite[] = [];
    private dryQuad: PIXI.Sprite;
    private fadeT = 0;
    private toMap: number; // мировые px → px карты
    private mapH: number;

    constructor(
        private renderer: PIXI.Renderer,
        private width: number, // ширина песчаной зоны (мир от x=0)
        private height: number
    ) {
        this.toMap = MAP_W / width;
        this.mapH = Math.round(height * this.toMap);
        this.map = PIXI.RenderTexture.create({ width: MAP_W, height: this.mapH });

        this.overlay = new PIXI.Sprite(this.map);
        this.overlay.width = width;
        this.overlay.height = height;
        this.overlay.blendMode = "multiply";
        this.overlay.eventMode = "none";

        this.dryQuad = new PIXI.Sprite(PIXI.Texture.WHITE);
        this.dryQuad.width = MAP_W;
        this.dryQuad.height = this.mapH;
        this.dryQuad.blendMode = "add";

        // Старт: чистый (белый) песок. Свежая RenderTexture не обязана быть
        // чистой — заливаем явно обычным блендом.
        this.dryQuad.blendMode = "normal";
        this.renderer.render({ container: this.dryQuad, target: this.map, clear: true });
        this.dryQuad.blendMode = "add";
    }

    // Пачка кругов (сегменты змейки, r — радиус коллайдера) — один рендер-проход.
    public stamp(circles: Array<{ x: number; y: number; r: number }>): void {
        if (circles.length === 0) return;
        while (this.pool.length < circles.length) {
            const s = new PIXI.Sprite(makeBlobTexture());
            s.anchor.set(0.5);
            s.blendMode = "multiply";
            s.alpha = STAMP_ALPHA;
            this.pool.push(s);
            this.stampLayer.addChild(s);
        }
        for (let i = 0; i < this.pool.length; i++) {
            const s = this.pool[i];
            if (i >= circles.length) {
                s.visible = false;
                continue;
            }
            const c = circles[i];
            s.visible = true;
            s.position.set(c.x * this.toMap, c.y * this.toMap);
            // коллайдер уже видимого тела (×0.55) → ×2.4 даёт дорожку чуть уже силуэта
            s.width = s.height = Math.max(2, c.r * 2.4 * this.toMap);
        }
        this.renderer.render({ container: this.stampLayer, target: this.map, clear: false });
    }

    // Ветер потихоньку заметает след.
    public update(delta: number): void {
        this.fadeT += delta;
        if (this.fadeT < FADE_PERIOD) return;
        this.fadeT = 0;
        this.dryQuad.alpha = FADE_ADD;
        this.renderer.render({ container: this.dryQuad, target: this.map, clear: false });
    }
}

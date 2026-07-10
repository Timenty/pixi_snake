import * as PIXI from "pixi.js";

interface Drop {
    sprite: PIXI.Sprite;
    vx: number;
    vy: number;
    groundY: number; // мировая Y, где капля «приземляется»
}

interface Splash {
    g: PIXI.Graphics;
    life: number;
}

const SPLASH_LIFE = 16; // тиков живёт всплеск

// Мир крупнее экрана: базовый зум 0.25 → мировые размеры ×4 к экранным.
const WORLD_SCALE = 4;

// Штрих капли: узкая вертикальная полоска с градиентом (хвост прозрачный).
function makeDropTexture(): PIXI.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 6;
    canvas.height = 40;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "rgba(190, 225, 255, 0)");
    grad.addColorStop(0.7, "rgba(215, 240, 255, 0.75)");
    grad.addColorStop(1, "rgba(240, 250, 255, 1)");
    ctx.fillStyle = grad;
    ctx.fillRect(1.5, 0, 3, canvas.height);
    return PIXI.Texture.from(canvas);
}

/**
 * Дождь в МИРОВЫХ координатах: контейнер лежит в viewport, капли привязаны
 * к поверхности — камера едет, а дождь остаётся над своим куском земли.
 * Капли спавнятся только вокруг видимой области (мир большой, льём где видно),
 * летят под небольшим углом и «приземляются» на случайной высоте (вид сверху —
 * земля везде), в точке падения расходится всплеск.
 * Интенсивность 0..1 меняется плавно — дождь начинается и стихает, а не щёлкает.
 */
export class Rain {
    public readonly container = new PIXI.Container();
    // Вызывается в точке приземления капли (мировые координаты) — почва мокнет.
    public onLand?: (x: number, y: number) => void;
    private drops: Drop[] = [];
    private splashes: Splash[] = [];
    private dropTex: PIXI.Texture;
    private current = 0; // текущая интенсивность (ползёт к target)
    private target = 0;
    private spawnCarry = 0; // дробный остаток спавна между кадрами
    private windDir = -1; // знак наклона капель: −1 = снос влево (по умолч. как облака)

    constructor() {
        this.container.interactive = false;
        this.dropTex = makeDropTexture();
    }

    public get intensity(): number {
        return this.current;
    }

    // Целевая интенсивность 0..1; 0.3 — «чуть-чуть льётся» для слепого дождя.
    public setTarget(intensity: number): void {
        this.target = Math.max(0, Math.min(1, intensity));
    }

    // Направление сноса капель (−1 влево … +1 вправо) — согласуется
    // с дрейфом облаков, чтобы дождь летел «по ветру».
    public setWindDirection(dir: number): void {
        this.windDir = Math.max(-1, Math.min(1, dir)) || -1;
    }

    // view — видимая область мира (viewport.getVisibleBounds()).
    public update(
        delta: number,
        view: { x: number; y: number; width: number; height: number }
    ): void {
        // Плавный подход к целевой интенсивности (~3-4 сек).
        this.current += (this.target - this.current) * Math.min(1, 0.015 * delta);
        if (this.current < 0.002 && this.target === 0) this.current = 0;

        // Спавн: ~2.2 капли/тик при интенсивности 1 (плотность на экран).
        this.spawnCarry += this.current * 2.2 * delta;
        while (this.spawnCarry >= 1) {
            this.spawnCarry -= 1;
            this.spawnDrop(view);
        }

        // Полёт капель.
        for (let i = this.drops.length - 1; i >= 0; i--) {
            const d = this.drops[i];
            d.sprite.x += d.vx * delta;
            d.sprite.y += d.vy * delta;
            if (d.sprite.y >= d.groundY) {
                this.spawnSplash(d.sprite.x, d.groundY);
                this.container.removeChild(d.sprite);
                this.drops.splice(i, 1);
            }
        }

        // Всплески: расходящийся эллипс, гаснет.
        for (let i = this.splashes.length - 1; i >= 0; i--) {
            const s = this.splashes[i];
            s.life += delta;
            const t = s.life / SPLASH_LIFE;
            if (t >= 1) {
                this.container.removeChild(s.g);
                this.splashes.splice(i, 1);
                continue;
            }
            s.g.clear();
            s.g.lineStyle(2.5 * WORLD_SCALE, 0xdcf0ff, 0.7 * (1 - t));
            // приплюснутый эллипс — круги на земле в top-down чуть сплющены бликом
            const r = (3 + t * 11) * WORLD_SCALE;
            s.g.drawEllipse(0, 0, r, r * 0.6);
        }
    }

    private spawnDrop(view: { x: number; y: number; width: number; height: number }): void {
        const sprite = new PIXI.Sprite(this.dropTex);
        // лёгкий снос по ветру облаков
        const vx = this.windDir * (2.0 + Math.random() * 0.8) * WORLD_SCALE;
        const vy = (15 + Math.random() * 7) * WORLD_SCALE;
        sprite.anchor.set(0.5, 1); // низ спрайта = «остриё» капли
        sprite.rotation = Math.atan2(vy, vx) - Math.PI / 2;
        sprite.alpha = 0.65 + Math.random() * 0.3;
        sprite.scale.set(WORLD_SCALE * (0.85 + Math.random() * 0.3));
        // Сыплем с запасом за края экрана (pad), чтобы при движении камеры
        // на кромке не открывалась «сухая» полоса без капель.
        const pad = 150 * WORLD_SCALE;
        sprite.x = view.x - pad + Math.random() * (view.width + pad * 2);
        sprite.y = view.y - 60 * WORLD_SCALE;
        this.container.addChild(sprite);
        this.drops.push({
            sprite,
            vx,
            vy,
            // земля везде — вид сверху; чуть выходим за края, но не выше точки спавна
            groundY: Math.max(
                sprite.y + 40 * WORLD_SCALE,
                view.y - pad + Math.random() * (view.height + pad * 2)
            ),
        });
    }

    private spawnSplash(x: number, y: number): void {
        const g = new PIXI.Graphics();
        g.position.set(x, y);
        this.container.addChild(g);
        this.splashes.push({ g, life: 0 });
        if (this.onLand) this.onLand(x, y);
    }
}

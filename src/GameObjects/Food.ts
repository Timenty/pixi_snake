import * as PIXI from "pixi.js";

export type FoodKind = "normal" | "golden" | "drop";

// Еда трёх видов:
//  normal — обычная (1 очко), golden — редкая (5 очков, крупнее),
//  drop — выпадает из отрезанного хвоста при самоукусе (не респавнится, съел — исчезла).
export class Food {
    private graphics: PIXI.Graphics;
    private _radius: number;
    private margin: number;
    private _kind: FoodKind = "normal";
    private _value = 1;
    // Пульсация: фаза случайная, чтобы еда не дышала синхронно.
    private pulsePhase = Math.random() * Math.PI * 2;

    constructor(
        private worldWidth: number,
        private worldHeight: number,
        radius = 80,
        margin = 200
    ) {
        this._radius = radius;
        this.margin = margin;

        this.graphics = new PIXI.Graphics();
        this.graphics.eventMode = "none";

        this.respawn();
    }

    private draw(color: number): void {
        const g = this.graphics;
        const r = this._radius;
        g.clear();
        // Тень (top-down): тёмный круг со смещением, рисуем первым → под едой.
        g.circle(6, 10, r).fill({ color: 0x000000, alpha: 0.25 });
        g.circle(0, 0, r).fill(color);
        // Блик сверху-слева — в тон освещению травы.
        g.circle(-r * 0.3, -r * 0.35, r * 0.25).fill({ color: 0xffffff, alpha: 0.35 });
    }

    public respawn(): void {
        const golden = Math.random() < 0.1;
        this._kind = golden ? "golden" : "normal";
        this._value = golden ? 5 : 1;
        this._radius = golden ? 100 : 80;
        this.draw(golden ? 0xffcc33 : 0xff3366);

        const x = this.margin + Math.random() * (this.worldWidth - this.margin * 2);
        const y = this.margin + Math.random() * (this.worldHeight - this.margin * 2);
        this.graphics.position.set(x, y);
    }

    // Превратить в «дроп» из хвоста: мельче, бледнее, фиксированная позиция.
    public becomeDrop(x: number, y: number): void {
        this._kind = "drop";
        this._value = 1;
        this._radius = 45;
        this.draw(0xff7799);
        this.graphics.position.set(x, y);
    }

    // Пульсация размера; золотая дышит заметнее.
    public update(delta: number): void {
        this.pulsePhase += 0.06 * delta;
        const amp = this._kind === "golden" ? 0.12 : 0.06;
        const s = 1 + amp * Math.sin(this.pulsePhase);
        this.graphics.scale.set(s);
    }

    public get model(): PIXI.Graphics {
        return this.graphics;
    }
    public get position(): PIXI.Point {
        return this.graphics.position as PIXI.Point;
    }
    public get radius(): number {
        return this._radius;
    }
    public get value(): number {
        return this._value;
    }
    public get kind(): FoodKind {
        return this._kind;
    }
}

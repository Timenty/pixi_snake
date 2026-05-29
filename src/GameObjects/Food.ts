import * as PIXI from "pixi.js";

export class Food {
    private graphics: PIXI.Graphics;
    private _radius: number;
    private margin: number;

    constructor(
        private worldWidth: number,
        private worldHeight: number,
        radius = 80,
        margin = 200
    ) {
        this._radius = radius;
        this.margin = margin;

        this.graphics = new PIXI.Graphics();
        // Тень (top-down): тёмный круг со смещением, рисуем первым → под едой.
        this.graphics.beginFill(0x000000, 0.25);
        this.graphics.drawCircle(6, 10, radius);
        this.graphics.endFill();
        this.graphics.beginFill(0xff3366);
        this.graphics.drawCircle(0, 0, radius);
        this.graphics.endFill();
        this.graphics.interactive = false;

        this.respawn();
    }

    public respawn(): void {
        const x = this.margin + Math.random() * (this.worldWidth - this.margin * 2);
        const y = this.margin + Math.random() * (this.worldHeight - this.margin * 2);
        this.graphics.position.set(x, y);
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
}

import * as PIXI from "pixi.js";
import { PushableBody } from "../Physics/PushableBody";

export interface CrateOptions {
    x: number;
    y: number;
    size?: number; // сторона ящика в мировых px
    mass?: number; // вес: 1 — лёгкий, больше — тяжелее (см. PushableBody)
}

/**
 * Толкаемый ящик: спрайт + тень поверх физики PushableBody (OBB-квадрат).
 * Не еда — змейка выталкивает его телом, головой сильнее (Snake.pushBody),
 * толчок в край разворачивает. Новые подобные тела делаются по образцу:
 * подкласс PushableBody с формой и syncVisual.
 */
export class Crate extends PushableBody {
    public readonly model: PIXI.Container;
    private sprite: PIXI.Sprite;
    private shadow: PIXI.Sprite;

    constructor(texture: PIXI.Texture, opts: CrateOptions) {
        const size = opts.size ?? 280;
        super(
            { kind: "box", half: size * 0.5 },
            { ...opts, rot: (Math.random() - 0.5) * 0.12 } // ящики стоят чуть вразнобой
        );

        this.model = new PIXI.Container();
        this.model.eventMode = "none";

        // Тень — как у змейки: смещение под свет сверху-слева.
        this.shadow = new PIXI.Sprite(texture);
        this.shadow.anchor.set(0.5);
        this.shadow.width = this.shadow.height = size;
        this.shadow.tint = 0x000000;
        this.shadow.alpha = 0.25;
        this.shadow.position.set(6, 10);
        this.model.addChild(this.shadow);

        this.sprite = new PIXI.Sprite(texture);
        this.sprite.anchor.set(0.5);
        this.sprite.width = this.sprite.height = size;
        this.model.addChild(this.sprite);

        this.syncVisual();
    }

    protected syncVisual(): void {
        this.sprite.rotation = this.shadow.rotation = this.rot;
        this.model.position.set(this.x, this.y);
    }
}

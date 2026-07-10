// Система толкаемых тел: змейка (или любой другой «толкатель», отдающий круги
// сегментов через pushBody) выталкивает тела, тела расталкиваются между собой
// и скользят с трением. Визуал — на подклассе (пример: GameObjects/Crate.ts),
// здесь только физика.

// Форма коллайдера: круг или повёрнутый квадрат (OBB — угол тела учитывается,
// толчок мимо центра даёт крутящий момент).
export type PushableShape =
    | { kind: "circle"; radius: number }
    | { kind: "box"; half: number };

export interface PushableBodyOptions {
    x: number;
    y: number;
    // Вес: 1 — лёгкий (легко разгоняется, далеко скользит, быстро крутится),
    // больше — тяжелее. Влияет на выталкивание, инерцию и расталкивание тел.
    mass?: number;
    rot?: number; // стартовый угол (рад)
    friction?: number; // затухание скорости за кадр (60fps-дельта), 0..1
    wallBounce?: number; // доля скорости, остающаяся при отскоке от края мира
    impulseK?: number; // сила линейного импульса от толчка
    torqueK?: number; // сила углового импульса от толчка (box; у круга момента нет)
}

export abstract class PushableBody {
    public x: number;
    public y: number;
    public rot: number;
    public mass: number;
    public vx = 0;
    public vy = 0;
    public angVel = 0;

    private friction: number;
    private wallBounce: number;
    private impulseK: number;
    private torqueK: number;

    protected constructor(public readonly shape: PushableShape, opts: PushableBodyOptions) {
        this.x = opts.x;
        this.y = opts.y;
        this.rot = opts.rot ?? 0;
        this.mass = Math.max(0.2, opts.mass ?? 1);
        this.friction = opts.friction ?? 0.9;
        this.wallBounce = opts.wallBounce ?? 0.3;
        this.impulseK = opts.impulseK ?? 0.05;
        this.torqueK = opts.torqueK ?? 0.001;
    }

    // Радиус для грубых проверок: расталкивание тел и границы мира.
    public get boundRadius(): number {
        return this.shape.kind === "circle" ? this.shape.radius : this.shape.half * 1.1;
    }

    // Столкновение с кругом (сегмент змейки). boost — множитель силы
    // (голова толкает сильнее тела).
    public pushCircle(cx: number, cy: number, r: number, boost = 1): void {
        if (this.shape.kind === "circle") {
            const dx = this.x - cx;
            const dy = this.y - cy;
            const dist = Math.hypot(dx, dy);
            const overlap = r + this.shape.radius - dist;
            if (overlap <= 0 || dist < 0.001) return;
            // нормаль через центр — момента у круга нет
            this.applyPush(dx / dist, dy / dist, overlap, boost, 0);
            return;
        }

        // Круг против OBB: переводим центр круга в локальные оси квадрата,
        // ищем ближайшую точку, при перекрытии — нормаль и плечо момента.
        const half = this.shape.half;
        const cos = Math.cos(this.rot);
        const sin = Math.sin(this.rot);
        const wx = cx - this.x;
        const wy = cy - this.y;
        const dx = wx * cos + wy * sin;
        const dy = -wx * sin + wy * cos;
        const qx = Math.max(-half, Math.min(half, dx));
        const qy = Math.max(-half, Math.min(half, dy));

        let lnx: number; // нормаль толчка в локальных осях (от круга к телу)
        let lny: number;
        let overlap: number;
        if (qx === dx && qy === dy) {
            // Центр круга внутри квадрата — наружу по оси меньшего проникновения.
            const px = half + r - Math.abs(dx);
            const py = half + r - Math.abs(dy);
            if (px < py) { lnx = -(Math.sign(dx) || 1); lny = 0; overlap = px; }
            else { lnx = 0; lny = -(Math.sign(dy) || 1); overlap = py; }
        } else {
            const vx = dx - qx; // от ближайшей точки квадрата к центру круга
            const vy = dy - qy;
            const dist = Math.hypot(vx, vy);
            overlap = r - dist;
            if (overlap <= 0 || dist < 0.001) return;
            lnx = -vx / dist;
            lny = -vy / dist;
        }

        // локальные оси → мир; плечо момента — точка контакта против центра:
        // толчок в центр грани едет ровно, в угол — разворачивает тело.
        const nx = lnx * cos - lny * sin;
        const ny = lnx * sin + lny * cos;
        const rx = qx * cos - qy * sin;
        const ry = qx * sin + qy * cos;
        const lever = (rx * ny - ry * nx) / half; // -1..1
        this.applyPush(nx, ny, overlap, boost, lever);
    }

    private applyPush(nx: number, ny: number, overlap: number, boost: number, lever: number): void {
        // Позиционное выталкивание: тяжёлое тело поддаётся медленнее —
        // змейка его «продавливает» с видимым усилием, лёгкое отскакивает сразу.
        const give = Math.min(0.5, 0.06 + 0.44 / this.mass);
        this.x += nx * overlap * give;
        this.y += ny * overlap * give;
        // Импульсы: скольжение и вращение после толчка, гасятся трением в update.
        const imp = (overlap * this.impulseK * boost) / this.mass;
        this.vx += nx * imp;
        this.vy += ny * imp;
        this.angVel += (lever * overlap * this.torqueK * boost) / this.mass;
    }

    // Расталкивание двух тел: кругами по boundRadius — точный SAT для пары
    // повёрнутых квадратов не окупается. Доли — обратно пропорционально массам.
    public static separate(a: PushableBody, b: PushableBody): void {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const overlap = a.boundRadius + b.boundRadius - dist;
        if (overlap <= 0) return;
        const nx = dx / dist;
        const ny = dy / dist;
        const total = a.mass + b.mass;
        a.x -= nx * overlap * (b.mass / total);
        a.y -= ny * overlap * (b.mass / total);
        b.x += nx * overlap * (a.mass / total);
        b.y += ny * overlap * (a.mass / total);
    }

    public update(delta: number, worldWidth: number, worldHeight: number): void {
        this.x += this.vx * delta;
        this.y += this.vy * delta;
        this.rot += this.angVel * delta;
        // Трение о землю: экспоненциальное затухание скольжения и вращения.
        const f = Math.pow(this.friction, delta);
        this.vx *= f;
        this.vy *= f;
        this.angVel *= f;

        // Не выпускаем за мир: мягкий отскок от стен.
        const m = this.boundRadius * 1.1 + 40;
        if (this.x < m) { this.x = m; this.vx *= -this.wallBounce; }
        if (this.x > worldWidth - m) { this.x = worldWidth - m; this.vx *= -this.wallBounce; }
        if (this.y < m) { this.y = m; this.vy *= -this.wallBounce; }
        if (this.y > worldHeight - m) { this.y = worldHeight - m; this.vy *= -this.wallBounce; }

        this.syncVisual();
    }

    // Подкласс переносит x/y/rot на свой спрайт (зовётся из update).
    protected abstract syncVisual(): void;
}

// Один шаг мира толкаемых тел: толкатель (змейка) против каждого тела,
// попарное расталкивание, интеграция. Зовётся из тикера раз в кадр.
export function stepPushables(
    bodies: PushableBody[],
    pusher: { pushBody(target: { pushCircle(cx: number, cy: number, r: number, boost?: number): void }): void },
    delta: number,
    worldWidth: number,
    worldHeight: number
): void {
    for (let i = 0; i < bodies.length; i++) {
        pusher.pushBody(bodies[i]);
        for (let j = i + 1; j < bodies.length; j++) {
            PushableBody.separate(bodies[i], bodies[j]);
        }
        bodies[i].update(delta, worldWidth, worldHeight);
    }
}

import * as PIXI from "pixi.js";
import { ControlVector } from "../ObjectTypes/ControlVector";
import { SkinTextures } from "./SnakeSkin";
import { TaperedRope } from "./TaperedRope";
import * as logic from "../Physics/Vectors";

// Текстура «мокрого блика»: узкая светлая полоса по хребту, тайлится вдоль тела.
// Рисуется один раз на модуль — блик у всех кож одинаковый.
let shineTexCache: PIXI.Texture | null = null;
function shineTexture(): PIXI.Texture {
    if (shineTexCache) return shineTexCache;
    const canvas = document.createElement("canvas");
    canvas.width = 64; // power-of-two: REPEAT в WebGL1
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.3, "rgba(255,255,255,0.05)");
    grad.addColorStop(0.46, "rgba(255,255,255,0.55)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.75)");
    grad.addColorStop(0.54, "rgba(255,255,255,0.55)");
    grad.addColorStop(0.7, "rgba(255,255,255,0.05)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    shineTexCache = PIXI.Texture.from(canvas);
    shineTexCache.source.style.addressMode = "repeat";
    return shineTexCache;
}

export class Snake {
    // Голова и тело — два TaperedRope с общим профилем ширины: силуэт плавно
    // раздувается к середине и сходит на нет к хвосту (не «бочка»). Голова из
    // фиксированного числа точек → её текстура не растягивается. Тело — бесшовный
    // тайл с wrapMode REPEAT + textureScale=1: узор повторяется, а не тянется.
    private group: PIXI.Container; // общий контейнер обоих rope (смещён на 2000,2000)
    private headRope!: TaperedRope;
    private bodyRope!: TaperedRope;
    private shadowGroup!: PIXI.Container; // тёмный силуэт под змейкой (head+body rope)
    private shadowOffsetX = 6; // смещение тени (top-down: свет сверху-слева)
    private shadowOffsetY = 10;
    private shineRope: TaperedRope | null = null; // мокрый блик поверх (alpha = wetness)
    private wetness = 0; // 0 сухая .. 1 мокрая (управляет Weather)
    private headTex!: PIXI.Texture;
    private bodyTex!: PIXI.Texture;
    private headPointCount = 6; // точек в голове (пересчитывается под текстуру)
    private headBodyOverlap = 2; // тело заходит под голову на N точек → прячет шов на поворотах
    private colliderDebug: PIXI.Graphics;
    private colliderVisible = false; // показывать тестовый коллайдер
    private points: Array<PIXI.Point>; // «позвоночник» — чистая логика следования
    private renderPoints: Array<PIXI.Point>; // позвоночник + синусоида, идёт в rope
    // Скорость и руление — в единицах «на 60fps-кадр»: move() умножает на
    // ticker.deltaTime, поэтому фактическая скорость не зависит от герцовки
    // экрана (8×60 ≈ 480 px/с и на 60 Гц телефоне, и на 164 Гц мониторе).
    private speed = 8;
    private sections = 30;
    private sectionLength = 20;
    private readonly headSkip = 8; // первые секции всегда рядом с головой — пропускаем
    // Полуширина ленты = половина высоты текстуры (реальная толщина rope).
    private texHalf!: number; // ставится в applySkinTextures (вызов из конструктора)
    // Параметры змеиного покачивания тела
    private wavePhase = 0;
    private waveAmplitude = 50; // макс. боковое смещение (px) у хвоста — размах
    private waveLength = 0.2; // фаза на сегмент: ~0.3 даёт читаемый S-изгиб тела
    private waveSpeed = 0.12; // прирост фазы за 60fps-кадр (скорость волны)
    // Рулёжка: текущий курс головы (рад) и макс. доворот за 60fps-кадр.
    // Лимит не даёт развернуться в себя напрямую — только дугой
    // (радиус дуги = speed/maxTurn ≈ 73 px).
    private headingAngle = Math.PI; // старт: смотрит вдоль -X (от хвоста)
    private maxTurn = 0.11;
    private direction!: ControlVector;
    // Границы мира в локальных координатах группы (голова не выходит за них).
    private bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    // «Живая морда»: глаза и язык рисуются поверх головы (см. updateFace).
    private eyesG!: PIXI.Graphics;
    private tongueG!: PIXI.Graphics;
    private blinkTimer = 150 + Math.random() * 300; // тиков до следующего моргания
    private blinkPhase = -1; // <0 — глаза открыты, иначе — прогресс моргания
    private saccadeTimer = 0; // микро-движения зрачков в «покое»
    private saccadeX = 0;
    private saccadeY = 0;
    private tongueTimer = 200 + Math.random() * 300;
    private tonguePhase = -1;

    constructor(private container: PIXI.Container, skin: SkinTextures) {
        this.points = this.calculatePoints();
        this.renderPoints = this.points.map(p => p.clone());

        this.applySkinTextures(skin);

        this.group = new PIXI.Container();
        this.group.x = 2000;
        this.group.y = 2000;
        this.container.addChild(this.group);

        this.headRope = this.makeHeadRope();
        this.buildBody(); // создаёт bodyRope под головой
        this.buildShadow(); // тень в самый низ группы
        this.group.addChild(this.headRope); // голова поверх тела
        this.tongueG = new PIXI.Graphics(); // язык — под бликом, поверх головы
        this.eyesG = new PIXI.Graphics();
        this.group.addChild(this.tongueG);
        this.group.addChild(this.eyesG);
        this.buildShine(); // блик — над всем

        this.colliderDebug = new PIXI.Graphics();
        this.colliderDebug.x = 2000;
        this.colliderDebug.y = 2000;
        this.colliderDebug.visible = this.colliderVisible;
        this.container.addChild(this.colliderDebug);
    }

    // Текстуры кожи + производные величины. Кол-во точек головы подбираем так,
    // чтобы её физ. длина ≈ ширине арта → рисуется без растяжения.
    private applySkinTextures(skin: SkinTextures): void {
        this.headTex = skin.head;
        this.bodyTex = skin.body;
        this.texHalf = this.bodyTex.height / 2;
        this.headPointCount = Math.max(2, Math.round(this.headTex.width / this.sectionLength) + 1);
    }

    // Профиль ширины всей змейки: t=0 нос → t=1 кончик хвоста.
    // Спереди ширина ПОСТОЯННАЯ: голова и тело в зоне стыка одинаковы →
    // ступеньки на шве нет в принципе (сужение носа рисует текстура головы).
    // Хвостовая часть плавно сходит в точку.
    private widthProfile(t: number): number {
        const taperStart = 0.55; // до этой доли длины — полная ширина
        if (t <= taperStart) return 1;
        const u = (t - taperStart) / (1 - taperStart);
        return Math.max(0.03, Math.pow(Math.cos((u * Math.PI) / 2), 0.85));
    }

    // Профиль для rope, покрывающего точки [start, start+count):
    // локальный t внутри rope переводим в глобальный t по всей змейке.
    private ropeProfile(start: number, count: number): (t: number) => number {
        return (t: number): number => {
            const n = this.points.length;
            const global = n > 1 ? (start + t * (count - 1)) / (n - 1) : 0;
            return this.widthProfile(global);
        };
    }

    // Смена кожи на лету: подменяем текстуры и пересоздаём все rope.
    // Старые текстуры не трогаем — ими владеет вызывающий код.
    public setSkin(skin: SkinTextures): void {
        this.applySkinTextures(skin);

        this.group.removeChild(this.headRope);
        this.headRope = this.makeHeadRope();
        this.buildBody();
        this.buildShadow();
        this.group.addChild(this.headRope); // голова снова поверх
        this.buildShine(); // блик над всем
        this.container.addChild(this.colliderDebug); // оверлей сверху
    }

    private makeHeadRope(): TaperedRope {
        return new TaperedRope(
            this.headTex,
            this.renderPoints.slice(0, this.headPointCount),
            0, // голова не тайлится — натуральный масштаб задан числом точек
            this.ropeProfile(0, this.headPointCount)
        );
    }

    // Переключить отображение тестового коллайдера. Возвращает новое состояние.
    public toggleCollider(): boolean {
        this.colliderVisible = !this.colliderVisible;
        this.colliderDebug.visible = this.colliderVisible;
        if (!this.colliderVisible) this.colliderDebug.clear();
        return this.colliderVisible;
    }

    // Радиус коллайдера сегмента: профиль меша × 0.55 — хитбокс уже видимого
    // силуэта. Иначе при развороте (диаметр дуги ≈ speed/maxTurn·2 = 150px)
    // голова цепляет своё тело по касательной и режет хвост без реального наезда.
    private segmentRadius(i: number): number {
        const t = this.points.length > 1 ? i / (this.points.length - 1) : 0;
        return this.texHalf * this.widthProfile(t) * 0.55;
    }

    // Тестовый коллайдер: круги по профилю текстуры в каждой точке.
    // Зелёный — голова, серый — пропущенные (headSkip), красный — проверяемое тело.
    public drawCollider(): void {
        if (!this.colliderVisible) return;
        const g = this.colliderDebug;
        g.clear();
        for (let i = 0; i < this.renderPoints.length; i++) {
            const p = this.renderPoints[i];
            let color = 0xff0000; // тело, участвует в проверке самоукуса
            if (i === 0) color = 0x00ff00; // голова
            else if (i < this.headSkip) color = 0x888888; // пропускается

            g.circle(p.x, p.y, this.segmentRadius(i)).stroke({
                width: 3,
                color,
                alpha: 0.9,
            });
        }
    }

    // Старт тела: сдвинут на overlap точек внутрь головы — этот участок прячется
    // под головой и закрывает шов меша на поворотах.
    private bodyStartIndex(): number {
        return Math.max(0, this.headPointCount - 1 - this.headBodyOverlap);
    }

    private makeBodyRope(): TaperedRope {
        const bodyStart = this.bodyStartIndex();
        return new TaperedRope(
            this.bodyTex,
            this.renderPoints.slice(bodyStart),
            1, // wrapMode REPEAT на тайле → узор тайлится, а не растягивается
            this.ropeProfile(bodyStart, this.renderPoints.length - bodyStart)
        );
    }

    // Пересоздаём тело: геометрия фиксирует размер буфера → при изменении длины
    // пересоздаём. Сужение к хвосту делает профиль ширины — отдельный меш не нужен.
    private buildBody(): void {
        if (this.bodyRope) this.group.removeChild(this.bodyRope);
        this.bodyRope = this.makeBodyRope();
        this.group.addChildAt(this.bodyRope, 0); // тело под головой
    }

    // Мокрый блик: rope со светлой полосой по хребту поверх головы и тела.
    // Виден только когда змейка мокрая (alpha = wetness), сложение ADD —
    // подсвечивает кожу, не перекрашивая её.
    private buildShine(): void {
        if (this.shineRope) this.group.removeChild(this.shineRope);
        this.shineRope = new TaperedRope(
            shineTexture(),
            this.renderPoints.slice(),
            1, // тайлится вдоль тела как узор
            this.ropeProfile(0, this.renderPoints.length)
        );
        this.shineRope.blendMode = "add";
        this.shineRope.alpha = this.wetness * 0.55;
        this.group.addChild(this.shineRope); // поверх головы и тела
        // Морда поверх блика: белки глаз не должны пересвечиваться ADD-бликом.
        // buildShine зовётся последним во всех перестройках — здесь же
        // возвращаем язык и глаза на самый верх группы.
        if (this.tongueG) this.group.addChild(this.tongueG);
        if (this.eyesG) this.group.addChild(this.eyesG);
    }

    // «Живая морда» — зовётся из тикера каждый кадр.
    // Глаза: белки+зрачки поверх головы; зрачки смотрят по курсу, дёргаются
    // микро-саккадами, а если рядом еда (lookWorld) — следят за ней. Изредка
    // моргают. Язык периодически выстреливает вилкой из носа.
    public updateFace(delta: number, lookWorld?: { x: number; y: number } | null): void {
        const pts = this.renderPoints;
        if (pts.length < 4) return;

        // Позиция глаз: пропорции текстуры головы (см. SnakeSkin) в px мира —
        // ~52px от носа вдоль хребта, ±25.6px от оси. Идём по дугам сегментов.
        const EYE_DIST = 52;
        const EYE_SIDE = 25.6;
        let acc = 0;
        let i = 0;
        let segLen = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
        while (i < pts.length - 2 && acc + segLen < EYE_DIST) {
            acc += segLen;
            i++;
            segLen = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) || 1;
        }
        const t = (EYE_DIST - acc) / segLen;
        const ax = pts[i].x + (pts[i + 1].x - pts[i].x) * t;
        const ay = pts[i].y + (pts[i + 1].y - pts[i].y) * t;
        // точки идут от носа к хвосту → вперёд = против сегмента
        const fx = -(pts[i + 1].x - pts[i].x) / segLen;
        const fy = -(pts[i + 1].y - pts[i].y) / segLen;

        // Моргание: редкий быстрый цикл открыто→закрыто→открыто.
        this.blinkTimer -= delta;
        if (this.blinkTimer <= 0 && this.blinkPhase < 0) {
            this.blinkPhase = 0;
            this.blinkTimer = 180 + Math.random() * 340;
        }
        let open = 1;
        if (this.blinkPhase >= 0) {
            const BLINK_LEN = 14;
            this.blinkPhase += delta;
            open = Math.abs(Math.cos((Math.PI * this.blinkPhase) / BLINK_LEN));
            if (this.blinkPhase >= BLINK_LEN) {
                this.blinkPhase = -1;
                open = 1;
            }
        }

        // Саккады: зрачки в покое изредка перескакивают на новую точку.
        this.saccadeTimer -= delta;
        if (this.saccadeTimer <= 0) {
            this.saccadeTimer = 50 + Math.random() * 160;
            this.saccadeX = (Math.random() - 0.5) * 4;
            this.saccadeY = (Math.random() - 0.5) * 4;
        }

        const WHITE_R = 12.65;
        const PUPIL_R = 6.3;
        const WANDER = WHITE_R - PUPIL_R - 1; // зрачок не вылазит из белка
        const g = this.eyesG;
        g.clear();
        for (const side of [-1, 1]) {
            const ex = ax - fy * EYE_SIDE * side;
            const ey = ay + fx * EYE_SIDE * side;
            // Куда смотрит зрачок: за едой, иначе по курсу + саккада.
            let lx: number;
            let ly: number;
            if (lookWorld) {
                lx = lookWorld.x - this.group.x - ex;
                ly = lookWorld.y - this.group.y - ey;
            } else {
                lx = fx * 3 + this.saccadeX;
                ly = fy * 3 + this.saccadeY;
            }
            const ll = Math.hypot(lx, ly) || 1;
            const k = Math.min(WANDER, ll) / ll;

            const r = Math.max(0.12, open); // моргание: глаз схлопывается
            g.circle(ex, ey, WHITE_R * r).fill({ color: 0xffffff });
            if (open > 0.25) {
                g.circle(ex + lx * k, ey + ly * k, PUPIL_R * r).fill({ color: 0x1a1a2e });
            }
        }

        // Язык: вилка из носа, выстрел ~полсекунды раз в несколько секунд.
        this.tongueTimer -= delta;
        if (this.tongueTimer <= 0 && this.tonguePhase < 0) {
            this.tonguePhase = 0;
            this.tongueTimer = 250 + Math.random() * 400;
        }
        const tg = this.tongueG;
        tg.clear();
        if (this.tonguePhase >= 0) {
            const TONGUE_LEN = 30;
            this.tonguePhase += delta;
            if (this.tonguePhase >= TONGUE_LEN) this.tonguePhase = -1;
            else {
                const out = Math.sin((Math.PI * this.tonguePhase) / TONGUE_LEN);
                const len = 36 * out;
                if (len > 3) {
                    const nose = pts[0];
                    const nfx = -(pts[1].x - nose.x);
                    const nfy = -(pts[1].y - nose.y);
                    const nl = Math.hypot(nfx, nfy) || 1;
                    const dx = nfx / nl;
                    const dy = nfy / nl;
                    const bx = nose.x + dx * 2;
                    const by = nose.y + dy * 2;
                    const mx = bx + dx * len * 0.6;
                    const my = by + dy * len * 0.6;
                    const stroke = { width: 4, color: 0xd63b4f, cap: "round" as const };
                    tg.moveTo(bx, by).lineTo(mx, my).stroke(stroke);
                    // вилка: два кончика в стороны
                    for (const s of [-1, 1]) {
                        tg.moveTo(mx, my)
                            .lineTo(
                                bx + dx * len - dy * 5 * s,
                                by + dy * len + dx * 5 * s
                            )
                            .stroke(stroke);
                    }
                }
            }
        }
    }

    // Круги коллайдера всех сегментов в мировых координатах — для следа на
    // песке и любых внешних взаимодействий с телом.
    public forEachCircle(cb: (x: number, y: number, r: number, i: number) => void): void {
        for (let i = 0; i < this.renderPoints.length; i++) {
            const p = this.renderPoints[i];
            cb(p.x + this.group.x, p.y + this.group.y, this.segmentRadius(i), i);
        }
    }

    // Насколько змейка мокрая (0..1): блеск кожи. Зовёт Weather каждый тик.
    public setWetness(w: number): void {
        this.wetness = Math.max(0, Math.min(1, w));
        if (this.shineRope) this.shineRope.alpha = this.wetness * 0.55;
    }

    // Тень: тёмные копии головы и тела в одном контейнере, в самом низу.
    private buildShadow(): void {
        if (this.shadowGroup) this.group.removeChild(this.shadowGroup);
        this.shadowGroup = new PIXI.Container();
        this.shadowGroup.alpha = 0.25;
        this.shadowGroup.x = this.shadowOffsetX;
        this.shadowGroup.y = this.shadowOffsetY;

        const parts = [this.makeBodyRope(), this.makeHeadRope()];
        for (const part of parts) {
            part.tint = 0x000000;
            this.shadowGroup.addChild(part);
        }

        this.group.addChildAt(this.shadowGroup, 0); // ниже тела и головы
    }

    // Накладываем боковую синусоиду на позвоночник → renderPoints (то, что рисует rope).
    // Смещение перпендикулярно телу, амплитуда растёт к хвосту, волна бежит вдоль тела.
    private applyWave(throttle: number, delta: number): void {
        // Скорость волны синхронизирована с газом (0..1): на месте волна замирает.
        this.wavePhase += this.waveSpeed * throttle * delta;
        const n = this.points.length;
        for (let i = 0; i < n; i++) {
            const p = this.points[i];
            const ref = this.points[i === 0 ? 1 : i - 1] || p;
            let dx = ref.x - p.x;
            let dy = ref.y - p.y;
            const len = Math.hypot(dx, dy) || 1;
            dx /= len;
            dy /= len;
            // перпендикуляр к направлению тела
            const px = -dy;
            const py = dx;
            const t = n > 1 ? i / (n - 1) : 0; // 0 у головы → 1 у хвоста
            const amp = this.waveAmplitude * t;
            const offset = amp * Math.sin(i * this.waveLength - this.wavePhase);
            this.renderPoints[i].x = p.x + px * offset;
            this.renderPoints[i].y = p.y + py * offset;
        }
    }

    private calculatePoints(): Array<PIXI.Point> {
        const array = [];
        for (let i = 0; i < this.sections; i++) {
            array[i] = new PIXI.Point(i * this.sectionLength, 0);
        }

        return array;
    }

    // Ограничить голову миром: (0,0)..(w,h) в мировых координатах, с отступом margin.
    public setWorldBounds(w: number, h: number, margin = 80): void {
        this.bounds = {
            minX: margin - this.group.x,
            minY: margin - this.group.y,
            maxX: w - margin - this.group.x,
            maxY: h - margin - this.group.y,
        };
    }

    public get length(): number {
        return this.points.length;
    }

    public get model(): PIXI.Container {
        return this.group;
    }
    public get head(): PIXI.Point {
        return this.points[0];
    }
    public get headWorld(): { x: number; y: number } {
        return {
            x: this.group.x + this.head.x,
            y: this.group.y + this.head.y,
        };
    }

    // Рост змейки: SimpleRope в PIXI v5 фиксирует размер буфера по числу точек
    // на момент создания, поэтому пересоздаём rope с новым массивом точек.
    public grow(amount = 3): void {
        const tail: PIXI.Point = this.points[this.points.length - 1];
        for (let i = 0; i < amount; i++) {
            this.points.push(tail.clone());
            this.renderPoints.push(tail.clone());
        }
        this.sections += amount;

        this.buildBody(); // голова не меняется, пересоздаём только тело
        this.buildShadow();
        this.buildShine();
        this.container.addChild(this.colliderDebug); // держим оверлей сверху
    }

    // Самоукус: если голова коснулась своего тела — отрезаем от точки касания
    // до хвоста. Возвращает мировые координаты удалённых секций (пусто, если касания нет).
    public selfBite(): Array<{ x: number; y: number }> {
        const renderHead = this.renderPoints[0];
        // не режем внутрь головы и оставляем телу ≥2 точки
        const start = Math.max(this.headSkip, this.headPointCount + 1);
        for (let i = start; i < this.renderPoints.length; i++) {
            const d = logic.distanceBetweenPoints(renderHead, this.renderPoints[i]);
            // касание = пересечение кругов коллайдера головы и сегмента
            if (d < this.segmentRadius(0) + this.segmentRadius(i)) {
                const removed = this.points.slice(i).map(p => ({
                    x: p.x + this.group.x,
                    y: p.y + this.group.y,
                }));
                this.points = this.points.slice(0, i);
                this.renderPoints = this.renderPoints.slice(0, i);
                this.sections = this.points.length;

                this.buildBody(); // голова цела, пересоздаём тело
                this.buildShadow();
                this.buildShine();
                this.container.addChild(this.colliderDebug); // оверлей сверху
                return removed;
            }
        }
        return [];
    }

    // Прокатить все сегменты тела по толкаемому объекту: форму коллайдера
    // знает сам объект (пример — квадратный Crate.pushCircle), змейка лишь
    // отдаёт круги сегментов. Голова толкает заметно сильнее тела.
    public pushBody(target: {
        pushCircle(cx: number, cy: number, r: number, boost?: number): void;
    }): void {
        this.forEachCircle((x, y, r, i) => target.pushCircle(x, y, r, i === 0 ? 2.5 : 1));
    }

    // delta — ticker.deltaTime (1 = 60fps-кадр): движение не зависит от герцовки.
    public move(delta = 1): void {
        if (typeof this.direction === 'undefined')
            return;

        const move = this.direction;
        // console.log("move", move);

        // console.log('moveDirection', move);
        let LastPoint: PIXI.Point = this.head.clone();

        // Логика головы: доворачиваем курс к желаемому, но не больше maxTurn·delta.
        if (move.force > 0.001) {
            const desired = Math.atan2(-move.y, move.x);
            const turn = this.maxTurn * delta;
            // разница курсов, нормализованная в [-π, π]
            let diff = Math.atan2(
                Math.sin(desired - this.headingAngle),
                Math.cos(desired - this.headingAngle)
            );
            if (diff > turn) diff = turn;
            else if (diff < -turn) diff = -turn;
            this.headingAngle += diff;
        }

        const spd: number = move.force * this.speed * delta;
        LastPoint.x += Math.cos(this.headingAngle) * spd;
        LastPoint.y += Math.sin(this.headingAngle) * spd;

        // Не выпускаем голову за границы мира — скользим вдоль стены.
        if (this.bounds) {
            LastPoint.x = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, LastPoint.x));
            LastPoint.y = Math.min(this.bounds.maxY, Math.max(this.bounds.minY, LastPoint.y));
        }

        this.points[0] = LastPoint;
        // Каждую секцию держим ровно на sectionLength позади предыдущей.
        // Длина змейки постоянна и в покое, и при движении.
        for (let index = 1; index < this.points.length; index++) {
            const point: PIXI.Point = this.points[index];
            const distance: number = logic.distanceBetweenPoints(point, LastPoint);

            if (distance > this.sectionLength) {
                const ratio: number = this.sectionLength / distance;
                point.x = LastPoint.x - (LastPoint.x - point.x) * ratio;
                point.y = LastPoint.y - (LastPoint.y - point.y) * ratio;
            }

            this.points[index] = point;
            LastPoint = point;
        }

        this.applyWave(move.force, delta);
    }
    public set directionSet (newDirection:ControlVector) {
        this.direction = newDirection;
    }
}
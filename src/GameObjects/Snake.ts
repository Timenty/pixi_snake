import * as PIXI from "pixi.js";
import { ControlVector } from "../ObjectTypes/ControlVector";
import * as logic from "../Physics/Vectors";

export class Snake {
    // Голова и тело — два отдельных rope на одной текстуре. Голова из фиксированного
    // числа точек → её длина постоянна → текстура головы не растягивается. Тело тянется.
    private group: PIXI.Container; // общий контейнер обоих rope (смещён на 2000,2000)
    private headRope!: PIXI.SimpleRope;
    private bodyRope!: PIXI.SimpleRope;
    private shadowRope!: PIXI.SimpleRope; // тёмный силуэт под змейкой
    private shadowOffsetX = 6; // смещение тени (top-down: свет сверху-слева)
    private shadowOffsetY = 10;
    private headTex!: PIXI.Texture;
    private bodyTex!: PIXI.Texture;
    private headPointCount = 6; // точек в голове (пересчитывается под текстуру)
    private headTexFraction = 0.2; // доля ширины snake.png под голову
    private headBodyOverlap = 2; // тело заходит под голову на N точек → прячет шов на поворотах
    private colliderDebug: PIXI.Graphics;
    private colliderVisible = false; // показывать тестовый коллайдер
    private points: Array<PIXI.Point>; // «позвоночник» — чистая логика следования
    private renderPoints: Array<PIXI.Point>; // позвоночник + синусоида, идёт в rope
    private speed = 3;
    private sections = 30;
    private sectionLength = 20;
    private readonly headSkip = 8; // первые секции всегда рядом с головой — пропускаем
    // Полуширина ленты = половина высоты текстуры (реальная толщина rope).
    private texHalf = PIXI.Texture.from("snake").height / 2;
    // Параметры змеиного покачивания тела
    private wavePhase = 0;
    private waveAmplitude = 50; // макс. боковое смещение (px) у хвоста — размах
    private waveLength = 0.2; // фаза на сегмент: ~0.3 даёт читаемый S-изгиб тела
    private waveSpeed = 0.045; // прирост фазы за кадр (скорость волны) — меньше = медленнее
    // Рулёжка: текущий курс головы (рад) и макс. доворот за кадр.
    // Лимит не даёт развернуться в себя напрямую — только дугой.
    private headingAngle = Math.PI; // старт: смотрит вдоль -X (от хвоста)
    private maxTurn = 0.04; // макс. изменение курса за кадр (рад): радиус дуги > длины тела
    private direction!: ControlVector;

    constructor(private container: PIXI.Container) {
        this.points = this.calculatePoints();
        this.renderPoints = this.points.map(p => p.clone());

        // Делим текстуру на голову (левая часть) и тело (остаток).
        const tex = PIXI.Texture.from("snake");
        const base = tex.baseTexture;
        const W = tex.width;
        const H = tex.height;
        const headW = Math.round(W * this.headTexFraction);
        this.headTex = new PIXI.Texture(base, new PIXI.Rectangle(0, 0, headW, H));
        this.bodyTex = new PIXI.Texture(base, new PIXI.Rectangle(headW, 0, W - headW, H));
        // Кол-во точек головы подбираем так, чтобы её физ. длина ≈ ширине арта головы
        // → текстура головы рисуется в натуральном масштабе, без растяжения.
        this.headPointCount = Math.max(2, Math.round(headW / this.sectionLength) + 1);

        this.group = new PIXI.Container();
        this.group.x = 2000;
        this.group.y = 2000;
        this.container.addChild(this.group);

        this.headRope = new PIXI.SimpleRope(
            this.headTex,
            this.renderPoints.slice(0, this.headPointCount)
        );
        this.buildBody(); // создаёт bodyRope под головой
        this.buildShadow(); // тень в самый низ группы
        this.group.addChild(this.headRope); // голова поверх тела

        this.colliderDebug = new PIXI.Graphics();
        this.colliderDebug.x = 2000;
        this.colliderDebug.y = 2000;
        this.colliderDebug.visible = this.colliderVisible;
        this.container.addChild(this.colliderDebug);
    }

    // Переключить отображение тестового коллайдера. Возвращает новое состояние.
    public toggleCollider(): boolean {
        this.colliderVisible = !this.colliderVisible;
        this.colliderDebug.visible = this.colliderVisible;
        if (!this.colliderVisible) this.colliderDebug.clear();
        return this.colliderVisible;
    }

    // Радиус коллайдера сегмента: ширина из текстуры (texHalf) + профиль сужения
    // sin (0 на носу/хвосте, 1 в центре) — повторяет силуэт нарисованной змейки.
    private segmentRadius(i: number): number {
        const t = this.points.length > 1 ? i / (this.points.length - 1) : 0;
        const profile = Math.sin(t * Math.PI);
        return this.texHalf * (0.3 + 0.7 * profile);
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

            g.lineStyle(3, color, 0.9);
            g.drawCircle(p.x, p.y, this.segmentRadius(i));
        }
    }

    // Пересоздаём тело: rope от стыка с головой (общая точка headPointCount-1) до хвоста.
    // SimpleRope в PIXI v5 фиксирует размер буфера → при изменении длины пересоздаём.
    private buildBody(): void {
        if (this.bodyRope) this.group.removeChild(this.bodyRope);
        // Старт тела сдвинут на overlap точек внутрь головы — этот участок прячется
        // под головой и закрывает разрыв меша на поворотах.
        const bodyStart = Math.max(0, this.headPointCount - 1 - this.headBodyOverlap);
        this.bodyRope = new PIXI.SimpleRope(
            this.bodyTex,
            this.renderPoints.slice(bodyStart)
        );
        this.group.addChildAt(this.bodyRope, 0); // тело под головой
    }

    // Тень: тёмная копия всей змейки (одним rope), смещена и положена в самый низ.
    private buildShadow(): void {
        if (this.shadowRope) this.group.removeChild(this.shadowRope);
        this.shadowRope = new PIXI.SimpleRope(PIXI.Texture.from("snake"), this.renderPoints);
        this.shadowRope.tint = 0x000000;
        this.shadowRope.alpha = 0.25;
        this.shadowRope.x = this.shadowOffsetX;
        this.shadowRope.y = this.shadowOffsetY;
        this.group.addChildAt(this.shadowRope, 0); // ниже тела и головы
    }

    // Накладываем боковую синусоиду на позвоночник → renderPoints (то, что рисует rope).
    // Смещение перпендикулярно телу, амплитуда растёт к хвосту, волна бежит вдоль тела.
    private applyWave(spd: number): void {
        // Скорость волны синхронизирована с текущей скоростью змейки:
        // spd/speed = доля throttle (0..1). На месте (spd=0) волна замирает.
        this.wavePhase += this.waveSpeed * (spd / this.speed);
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
        this.container.addChild(this.colliderDebug); // держим оверлей сверху
    }

    // Самоукус: если голова коснулась своего тела — отрезаем от точки касания
    // до хвоста. Возвращает число удалённых секций (0 если касания нет).
    public selfBite(): number {
        const renderHead = this.renderPoints[0];
        // не режем внутрь головы и оставляем телу ≥2 точки
        const start = Math.max(this.headSkip, this.headPointCount + 1);
        for (let i = start; i < this.renderPoints.length; i++) {
            const d = logic.distanceBetweenPoints(renderHead, this.renderPoints[i]);
            // касание = пересечение кругов коллайдера головы и сегмента
            if (d < this.segmentRadius(0) + this.segmentRadius(i)) {
                const removed = this.points.length - i;
                this.points = this.points.slice(0, i);
                this.renderPoints = this.renderPoints.slice(0, i);
                this.sections = this.points.length;

                this.buildBody(); // голова цела, пересоздаём тело
                this.buildShadow();
                this.container.addChild(this.colliderDebug); // оверлей сверху
                return removed;
            }
        }
        return 0;
    }

    public move(): void {
        // console.log("this.direction", this.direction);
        if (typeof this.direction === 'undefined')
            return;

        const move = this.direction;
        // console.log("move", move);

        // console.log('moveDirection', move);
        let LastPoint: PIXI.Point = this.head.clone();

        // Логика головы: доворачиваем курс к желаемому, но не больше maxTurn за кадр.
        if (move.force > 0.001) {
            const desired = Math.atan2(-move.y, move.x);
            // разница курсов, нормализованная в [-π, π]
            let diff = Math.atan2(
                Math.sin(desired - this.headingAngle),
                Math.cos(desired - this.headingAngle)
            );
            if (diff > this.maxTurn) diff = this.maxTurn;
            else if (diff < -this.maxTurn) diff = -this.maxTurn;
            this.headingAngle += diff;
        }

        const spd: number = move.force * this.speed;
        LastPoint.x += Math.cos(this.headingAngle) * spd;
        LastPoint.y += Math.sin(this.headingAngle) * spd;

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

        this.applyWave(spd);
    }
    public set directionSet (newDirection:ControlVector) {
        this.direction = newDirection;
    }
}
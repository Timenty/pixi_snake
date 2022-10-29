import * as PIXI from "pixi.js";
import { ControlVector } from "../ObjectTypes/ControlVector";
import * as logic from "../Physics/Vectors";

export class Snake {
    private strip: PIXI.SimpleRope;
    private points: Array<PIXI.Point>;
    private speed = 10;
    private sections = 20;
    private sectionLength = 20;
    private direction!: ControlVector; 

    constructor() {
        // this.ropeLength = PIXI.Texture.from("snake").width / this.sections;
        this.points = this.calculatePoints();
        this.strip = new PIXI.SimpleRope(PIXI.Texture.from("snake"), this.points);
    }

    private calculatePoints(): Array<PIXI.Point> {
        const array = [];
        for (let i = 0; i < this.sections; i++) {
            array[i] = new PIXI.Point(i * (this.sections + this.sectionLength), 0);
        }

        return array;
    }

    public get model(): PIXI.SimpleRope {
        return this.strip;
    }
    public get head(): PIXI.Point {
        return this.points[0];
    }

    public move(): void {
        // console.log("this.direction", this.direction);
        if (typeof this.direction === 'undefined')
            return;

        const move = this.direction;
        // console.log("move", move);

        // console.log('moveDirection', move);
        let LastPoint: PIXI.Point = this.head.clone();

        // Логика головы
        const spd: number = move.force * this.speed;
        LastPoint.x += move.x * spd;
        LastPoint.y += -(move.y * spd);

        this.points[0] = LastPoint;
        // Логика смещения остальных частей
        // Не правильно идёт просчёт расстояния сдвига
        const speedForOtherSerctions: number = this.speed / move.force;

        for (let index = 1; index < this.points.length; index++) {
            const point: PIXI.Point = this.points[index];
            const distance: number = logic.distanceBetweenPoints(
                logic.pointABS(point),
                logic.pointABS(LastPoint)
            );

            if (distance >= this.sectionLength) {
                const vector: PIXI.Point = logic.vector(point, LastPoint);
                const moveDistance: PIXI.Point = logic.pointABS(vector);

                if (vector.x > 0) point.x += moveDistance.x / speedForOtherSerctions;
                else point.x -= moveDistance.x / speedForOtherSerctions;

                if (vector.y > 0) point.y += moveDistance.y / speedForOtherSerctions;
                else point.y -= moveDistance.y / speedForOtherSerctions;
            }

            this.points[index] = point;
            LastPoint = point;
        }
    }
    public set directionSet (newDirection:ControlVector) {
        this.direction = newDirection;
    }
}
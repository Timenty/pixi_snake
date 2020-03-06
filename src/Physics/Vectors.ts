import { Point } from "pixi.js";

const vector = (p1: Point, p2: Point): Point => (
    new Point(p2.x - p1.x, p2.y - p1.y)
);

const pointABS = (vector: Point): Point => (
    new Point(Math.abs(vector.x), Math.abs(vector.y))
);

const distanceBetweenPoints = (p1: Point, p2: Point): number => {
    return Math.sqrt(Math.abs(Math.pow(p2.x - p1.x, 2) - Math.pow(p2.y - p1.y, 2)))
};

export { vector, pointABS, distanceBetweenPoints };
import { Mesh, Point, RopeGeometry, Texture } from "pixi.js";

// t ∈ [0..1] вдоль rope → множитель полуширины ленты в этой точке.
export type WidthProfile = (t: number) => number;

// RopeGeometry с переменной шириной: вместо постоянной полуширины каждая точка
// получает свою — silhouette змейки сужается к хвосту, а не выглядит «бочкой».
export class TaperedRopeGeometry extends RopeGeometry {
    private profile?: WidthProfile;

    constructor(width: number, points: Point[], textureScale: number, profile: WidthProfile) {
        super({ width, points, textureScale });
        this.profile = profile;
        this.updateVertices(); // базовый конструктор считал вершины ещё без профиля
    }

    // Копия RopeGeometry.updateVertices из PIXI v8 + множитель profile(t).
    public updateVertices(): void {
        if (!this.profile) {
            // вызов из конструктора базового класса, профиль ещё не присвоен
            super.updateVertices();
            return;
        }
        const points = this.points;
        if (points.length < 1) return;

        let lastPoint = points[0];
        const vertexBuffer = this.buffers[0]; // aPosition
        const vertices = vertexBuffer.data as Float32Array;
        const total = points.length;
        const half =
            this.textureScale > 0 ? (this.textureScale * this.width) / 2 : this.width / 2;

        for (let i = 0; i < total; i++) {
            const point = points[i];
            const index = i * 4;
            const nextPoint = i < total - 1 ? points[i + 1] : point;

            let perpY = -(nextPoint.x - lastPoint.x);
            let perpX = nextPoint.y - lastPoint.y;
            const perpLength = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
            const w = half * this.profile(total > 1 ? i / (total - 1) : 0);

            perpX = (perpX / perpLength) * w;
            perpY = (perpY / perpLength) * w;

            vertices[index] = point.x + perpX;
            vertices[index + 1] = point.y + perpY;
            vertices[index + 2] = point.x - perpX;
            vertices[index + 3] = point.y - perpY;

            lastPoint = point;
        }

        vertexBuffer.update();
    }
}

// Аналог PIXI.MeshRope, но на TaperedRopeGeometry.
export class TaperedRope extends Mesh {
    public autoUpdate = true;

    constructor(
        texture: Texture,
        points: Point[],
        textureScale: number,
        profile: WidthProfile
    ) {
        if (textureScale > 0) texture.source.style.addressMode = "repeat";
        super({
            geometry: new TaperedRopeGeometry(texture.height, points, textureScale, profile),
            texture,
        });
        // Точки двигаются каждый кадр — пересчитываем геометрию перед рендером.
        this.onRender = (): void => {
            if (this.autoUpdate) (this.geometry as TaperedRopeGeometry).update();
        };
    }
}

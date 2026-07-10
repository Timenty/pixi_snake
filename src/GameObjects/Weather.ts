import { CloudShadows, CloudParams, SUNNY_CLOUDS, OVERCAST_CLOUDS } from "./CloudShadows";
import { Rain } from "./Rain";

export type WeatherKind = "sunny" | "overcast" | "sunshower";

const ORDER: WeatherKind[] = ["sunny", "overcast", "sunshower"];

interface WeatherPreset {
    clouds: CloudParams;
    rain: number; // целевая интенсивность дождя 0..1
}

const PRESETS: Record<WeatherKind, WeatherPreset> = {
    // Солнечно — дефолт: редкие облака, сухо.
    sunny: { clouds: SUNNY_CLOUDS, rain: 0 },
    // Пасмурно: рваная сплошная облачность + ровная серость, без дождя.
    overcast: { clouds: OVERCAST_CLOUDS, rain: 0 },
    // Слепой дождь: небо как в солнечную, но чуть-чуть льётся.
    sunshower: { clouds: SUNNY_CLOUDS, rain: 0.3 },
};

// Скорости намокания/высыхания за тик (60 тиков = 1 сек).
const WET_RATE = 0.0011; // под дождём интенсивности 0.3 → мокрая за ~17 c
const DRY_RATE = 0.0008; // сохнет ~20 c

/**
 * Менеджер погоды: переключает состояния, ведёт облака и дождь,
 * копит «мокрость» (0..1) — змейка блестит тем сильнее, чем мокрее.
 * Для будущих карт: погода задаётся при старте карты через set().
 */
export class Weather {
    private current: WeatherKind;
    private wet = 0;

    constructor(
        private clouds: CloudShadows,
        private rain: Rain,
        initial: WeatherKind = "sunny"
    ) {
        this.current = initial;
        const preset = PRESETS[initial];
        this.clouds.setParams(preset.clouds); // стартуем сразу в нужном состоянии
        this.rain.setTarget(preset.rain);
    }

    public get kind(): WeatherKind {
        return this.current;
    }

    // 0..1 — насколько змейка мокрая.
    public get wetness(): number {
        return this.wet;
    }

    public set(kind: WeatherKind, transitionSeconds = 5): void {
        if (kind === this.current) return;
        this.current = kind;
        const preset = PRESETS[kind];
        this.clouds.transitionTo(preset.clouds, transitionSeconds);
        this.rain.setTarget(preset.rain);
    }

    // Следующее состояние по кругу (дебаг-клавиша).
    public cycle(): WeatherKind {
        const next = ORDER[(ORDER.indexOf(this.current) + 1) % ORDER.length];
        this.set(next);
        return next;
    }

    // view — видимая область мира (viewport.getVisibleBounds()): дождь льём
    // в мировых координатах вокруг камеры.
    public update(
        delta: number,
        view: { x: number; y: number; width: number; height: number }
    ): void {
        this.clouds.update(delta);
        this.rain.update(delta, view);

        // Мокрость: растёт под дождём (быстрее при ливне), сохнет без него.
        if (this.rain.intensity > 0.03) {
            this.wet = Math.min(1, this.wet + WET_RATE * (0.5 + this.rain.intensity) * delta);
        } else {
            this.wet = Math.max(0, this.wet - DRY_RATE * delta);
        }
    }
}

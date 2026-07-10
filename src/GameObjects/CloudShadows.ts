import * as PIXI from "pixi.js";

/**
 * Параметры теней, которые можно плавно менять на лету (погода).
 * Всё остальное (ветер, масштаб) фиксируется при создании: их смена
 * телепортирует картинку, т.к. дрейф = wind * time.
 */
export interface CloudParams {
    coverA: number; // порог слоя A: меньше = облаков больше
    softA: number; // мягкость края
    darkA: number; // плотность тени
    coverB: number;
    softB: number;
    darkB: number;
    ambient: number; // ровное затемнение всего мира (пасмурность)
}

export interface CloudLayerOptions extends CloudParams {
    wind: [number, number]; // базовый ветер (noise-координаты за тик)
    scaleA: [number, number]; // ячеек шума на мир (меньше = облака крупнее)
    scaleB: [number, number];
    speedB: number; // множитель скорости слоя B
    // Доля UV у краёв меша, где тень плавно гаснет (0 = выкл). Нужно локальным
    // патчам (роща): без этого крону режет прямой край квада.
    edgeFade: number;
    // Ядро слоя A: 0 = плоская тень (облака), >0 — центр пятна гуще края
    // (крона дерева: света меньше всего у ствола).
    coreA: number;
    // Покачивание поля слоя A (амплитуда в ячейках шума; 0 = выкл) и частота.
    sway: number;
    swayFreq: number;
}

// Пороги подобраны по перцентилям поля (см. scratchpad/fbm_stats.js):
// поле после контраста имеет p50≈0.7 (A) / 0.59 (B).
export const SUNNY_CLOUDS: CloudParams = {
    coverA: 0.8, // ≈ p65 → тень над ~35% мира
    softA: 0.3,
    darkA: 0.42,
    coverB: 0.86, // ≈ p82 → редкие мелкие облачка
    softB: 0.25,
    darkB: 0.22,
    ambient: 0,
};

export const OVERCAST_CLOUDS: CloudParams = {
    coverA: 0.3, // почти всё поле выше порога → сплошная рваная облачность
    softA: 0.55,
    darkA: 0.35,
    coverB: 0.55,
    softB: 0.4,
    darkB: 0.18,
    ambient: 0.14, // ровная серость поверх
};

const DEFAULT_OPTIONS: CloudLayerOptions = {
    ...SUNNY_CLOUDS,
    wind: [0.0011, 0.0004], // медленный ветер по диагонали
    scaleA: [3.2, 3.2], // ~3 ячейки на мир → облака ~3-5k px
    scaleB: [9.0, 9.0],
    speedB: 3.4,
    edgeFade: 0, // меш облаков накрывает мир с запасом — краёв не видно
    coreA: 0, // облака — плоская тень без ядра
    sway: 0, // облака не качаются — только дрейф
    swayFreq: 0.02,
};

const PARAM_UNIFORM: Record<keyof CloudParams, string> = {
    coverA: "uCoverA",
    softA: "uSoftA",
    darkA: "uDarkA",
    coverB: "uCoverB",
    softB: "uSoftB",
    darkB: "uDarkB",
    ambient: "uAmbient",
};

/**
 * Плывущие тени облаков поверх игрового поля.
 * Меш на весь мир, в шейдере — fbm value-noise (аналог перлина).
 * Два слоя облаков: A — большие и медленные, B — поменьше и быстрее.
 * Внутри каждого слоя два подслоя шума дрейфуют с разной скоростью,
 * поэтому тени не «едут штампом», а медленно меняют форму.
 */
export class CloudShadows {
    public readonly mesh: PIXI.Mesh;
    private time = 0;
    private transition: {
        from: CloudParams;
        to: CloudParams;
        progress: number; // 0..1
        durationTicks: number;
    } | null = null;

    constructor(worldWidth: number, worldHeight: number, options?: Partial<CloudLayerOptions>) {
        const opts: CloudLayerOptions = { ...DEFAULT_OPTIONS, ...options };

        // Запас по краям — тени не «обрезаются» на границе мира.
        const pad = 1000;
        const w = worldWidth + pad * 2;
        const h = worldHeight + pad * 2;

        const vert = `
            attribute vec2 aVertexPosition;
            attribute vec2 aUvs;
            uniform mat3 translationMatrix;
            uniform mat3 projectionMatrix;
            varying vec2 vUvs;
            void main(void) {
                vUvs = aUvs;
                gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
            }
        `;

        const frag = `
            precision highp float;
            varying vec2 vUvs;
            uniform float uTime;
            uniform vec2 uWind;      // базовый ветер (noise-координаты за тик)
            uniform float uAmbient;  // ровное затемнение всего мира
            uniform float uEdgeFade; // затухание тени у краёв меша (0 = выкл)
            uniform float uCoreA;    // доля тени, добираемая только в ядре пятна
            uniform float uSway;     // амплитуда покачивания слоя A (0 = выкл)
            uniform float uSwayFreq; // частота покачивания
            // Слой A: большие медленные облака
            uniform vec2 uScaleA;    // ячеек шума на мир (меньше = облака крупнее)
            uniform float uCoverA;   // порог: меньше = облаков больше
            uniform float uSoftA;    // мягкость края
            uniform float uDarkA;    // плотность тени
            // Слой B: облака поменьше, летят быстрее, их меньше
            uniform vec2 uScaleB;
            uniform float uCoverB;
            uniform float uSoftB;
            uniform float uDarkB;
            uniform float uSpeedB;   // множитель скорости слоя B

            // Хеш без sin() — на разных GPU sin(большой аргумент) даёт разный
            // результат, а этот вариант (Dave Hoskins) везде считается одинаково.
            float hash(vec2 p) {
                vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(
                    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
                    u.y
                );
            }

            float fbm(vec2 p) {
                float v = 0.0;
                float a = 0.5;
                for (int i = 0; i < 4; i++) {
                    v += a * noise(p);
                    p = p * 2.03 + vec2(17.3, 9.1);
                    a *= 0.5;
                }
                return v / 0.9375; // нормализация в [0..1]
            }

            // Поле облачности: два подслоя шума дрейфуют с разной скоростью —
            // форма «дышит», а не едет как штамп. Возвращает контрастированное
            // значение шума (порог накладывается снаружи).
            float cloudN(vec2 uv, vec2 drift, vec2 seed) {
                float n1 = fbm(uv + drift + seed);
                float n2 = fbm(uv * 1.9 - drift * 0.55 + seed.yx * 2.7);
                float n = n1 * 0.65 + n2 * 0.35;
                // fbm жмётся к среднему (~0.5) — растягиваем контраст, иначе
                // порог почти ничего не видит.
                return 0.5 + (n - 0.5) * 3.0;
            }

            void main(void) {
                vec2 drift = uWind * uTime;

                // Покачивание на ветру: поле слоя A мягко ходит по эллипсу.
                vec2 swayOff = vec2(
                    sin(uTime * uSwayFreq),
                    cos(uTime * uSwayFreq * 0.77)
                ) * uSway;

                // A: большие медленные. Тело пятна + «ядро» (порог выше):
                // при uCoreA > 0 центр кроны гуще, край светлее.
                float nA = cloudN(vUvs * uScaleA + swayOff, drift, vec2(0.0, 0.0));
                float bodyA = smoothstep(uCoverA, uCoverA + uSoftA, nA);
                // Ядро начинается с середины кромки тела — иначе порог уедет
                // выше реального максимума поля и ядра не будет вовсе.
                float coreA = smoothstep(uCoverA + uSoftA * 0.5, uCoverA + uSoftA * 0.5 + 0.28, nA);
                float a = (bodyA * (1.0 - uCoreA) + coreA * uCoreA) * uDarkA;

                // B: помельче и побыстрее, ветер чуть под другим углом
                vec2 windB = vec2(drift.x * uSpeedB, drift.y * uSpeedB * 0.4);
                float nB = cloudN(vUvs * uScaleB, windB, vec2(19.1, 47.3));
                float b = smoothstep(uCoverB, uCoverB + uSoftB, nB) * uDarkB;

                // Смесь «экраном»: пересечение теней темнее, но не суммой в лоб.
                float clouds = a + b * (1.0 - a);
                float shadow = uAmbient + clouds * (1.0 - uAmbient);

                // Локальный патч (роща): гасим тень к краям меша, чтобы кроны
                // не резались прямой границей квада.
                if (uEdgeFade > 0.0) {
                    shadow *= smoothstep(0.0, uEdgeFade, vUvs.x)
                        * smoothstep(1.0, 1.0 - uEdgeFade, vUvs.x)
                        * smoothstep(0.0, uEdgeFade, vUvs.y)
                        * smoothstep(1.0, 1.0 - uEdgeFade, vUvs.y);
                }

                // premultiplied alpha: чёрная тень
                gl_FragColor = vec4(0.0, 0.0, 0.0, shadow);
            }
        `;

        const geometry = new PIXI.Geometry()
            .addAttribute("aVertexPosition", [0, 0, w, 0, w, h, 0, h], 2)
            .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);

        const shader = PIXI.Shader.from(vert, frag, {
            uTime: 0,
            uWind: opts.wind,
            uAmbient: opts.ambient,
            uScaleA: opts.scaleA,
            uCoverA: opts.coverA,
            uSoftA: opts.softA,
            uDarkA: opts.darkA,
            uScaleB: opts.scaleB,
            uCoverB: opts.coverB,
            uSoftB: opts.softB,
            uDarkB: opts.darkB,
            uSpeedB: opts.speedB,
            uEdgeFade: opts.edgeFade,
            uCoreA: opts.coreA,
            uSway: opts.sway,
            uSwayFreq: opts.swayFreq,
        });

        this.mesh = new PIXI.Mesh(geometry, shader as any);
        this.mesh.interactive = false;
        this.mesh.position.set(-pad, -pad);
    }

    private get uniforms(): Record<string, number> {
        return (this.mesh.shader as any).uniforms;
    }

    // Ветер шейдера. ВАЖНО: облака ВИЗУАЛЬНО дрейфуют против этого вектора
    // (поле сэмплится со сдвигом +drift) — для согласования дождя и т.п.
    public get windVector(): [number, number] {
        const w = (this.uniforms as any).uWind;
        return [w[0], w[1]];
    }

    private readParams(): CloudParams {
        const u = this.uniforms;
        const out = {} as CloudParams;
        for (const key of Object.keys(PARAM_UNIFORM) as Array<keyof CloudParams>) {
            out[key] = u[PARAM_UNIFORM[key]];
        }
        return out;
    }

    // Мгновенно выставить параметры (без анимации).
    public setParams(params: Partial<CloudParams>): void {
        this.transition = null;
        const u = this.uniforms;
        for (const key of Object.keys(params) as Array<keyof CloudParams>) {
            const value = params[key];
            if (value !== undefined) u[PARAM_UNIFORM[key]] = value;
        }
    }

    // Плавный переход к новым параметрам за seconds (смена погоды).
    public transitionTo(params: Partial<CloudParams>, seconds = 4): void {
        const from = this.readParams();
        this.transition = {
            from,
            to: { ...from, ...params },
            progress: 0,
            durationTicks: Math.max(1, seconds * 60),
        };
    }

    public update(delta: number): void {
        this.time += delta;
        const u = this.uniforms;
        u.uTime = this.time;

        const tr = this.transition;
        if (tr) {
            tr.progress = Math.min(1, tr.progress + delta / tr.durationTicks);
            const t = tr.progress * tr.progress * (3 - 2 * tr.progress); // smoothstep
            for (const key of Object.keys(PARAM_UNIFORM) as Array<keyof CloudParams>) {
                u[PARAM_UNIFORM[key]] = tr.from[key] + (tr.to[key] - tr.from[key]) * t;
            }
            if (tr.progress >= 1) this.transition = null;
        }
    }
}

// Тени крон деревьев: та же машинерия, но поле почти статично — крона
// едва «дышит» на ветру. Слой B выключен. Пятна мелкие и с резким краем.
// Пока нигде не используется — заготовка для лесных карт.
export const TREE_SHADOW_OPTIONS: Partial<CloudLayerOptions> = {
    wind: [0.00006, 0.000025],
    scaleA: [22, 22], // пятна ~400-700 px — размер кроны
    coverA: 0.88,
    softA: 0.12, // резковатый край — листва, не облако
    darkA: 0.48,
    coreA: 0.5, // у ствола гуще: край ~половина плотности, ядро полная
    sway: 0.045, // лёгкое покачивание кроны (~±18 px)
    swayFreq: 0.016, // период ~6.5 с
    coverB: 2.0, // слой B за пределами поля — выключен
    darkB: 0,
    ambient: 0,
    edgeFade: 0.16, // роща — локальный патч, тень тает к краям меша
};

export class TreeShadows extends CloudShadows {
    constructor(worldWidth: number, worldHeight: number) {
        super(worldWidth, worldHeight, {
            ...TREE_SHADOW_OPTIONS,
            // Масштаб шума привязан к размеру меша: ячейка ~410 px —
            // кроны одинакового размера и у рощи 2500px, и на весь мир.
            scaleA: [worldWidth / 410, worldHeight / 410],
        });
    }
}

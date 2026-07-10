import * as PIXI from "pixi.js";

// Редкие вкрапления другой текстуры: доля ячеек untiling-сетки,
// которые целиком рисуются accent-текстурой (камни среди песка и т.п.).
export interface GroundAccent {
    texture: PIXI.Texture;
    fraction: number; // 0..1, напр. 0.08 = ~8% ячеек
}

// Попиксельное освещение по картам материала (вместо fake-фильтра по яркости).
export interface GroundLighting {
    normal: PIXI.Texture; // карта нормалей (OpenGL-конвенция, Y вверх)
    roughness?: PIXI.Texture; // шершавость: гасит блик (1 - rough)
    wetMap?: PIXI.Texture; // карта влажности мира (WetGround.texture) — мокрое бликует
    worldRect?: [number, number, number, number]; // x, y, w, h меша в мировых координатах
    worldSize?: [number, number]; // размер всего мира (uv для wetMap)
}

function isPow2(n: number): boolean {
    return n > 0 && (n & (n - 1)) === 0;
}

/**
 * Меш земли с шейдером «untiling»: тайлим текстуру, но каждую ячейку сэмплим
 * со случайным (по хешу) смещением и плавно блендим 4 соседних — видимые
 * повторы тайла исчезают, швов нет (техника Inigo Quilez).
 *
 * Для power-of-two текстур включается аппаратный REPEAT-сэмплинг (без fract
 * в шейдере): билинейная фильтрация корректно заворачивается через край тайла
 * и не рисует тонкую сетку на границах ячеек. Для NPOT (трава 1000×1000)
 * остаётся fract-вариант — WebGL1 не умеет REPEAT на NPOT.
 *
 * lighting — честный попиксельный свет: нормали сэмплятся ТЕМИ ЖЕ
 * untiling-смещениями, что и цвет (рельеф не разъезжается с картинкой),
 * диффуз + солнечный блик, который усиливается на мокрой земле (wetMap)
 * и гасится шершавостью (roughness). AO предполагается запечённым в цвет.
 *
 * fadeRight > 0 — правый край меша растворяется шумной волнистой кромкой
 * шириной ~fadeRight px: так биомы склеиваются органической границей,
 * а не прямой линией (меш кладётся ПОВЕРХ соседнего биома с нахлёстом).
 */
export function createGroundMesh(
    texture: PIXI.Texture,
    width: number,
    height: number,
    fadeRight = 0,
    accent?: GroundAccent,
    lighting?: GroundLighting
): PIXI.Mesh {
    // NB: не MIRRORED_REPEAT — на направленных текстурах (дюны) зеркалка
    // даёт «ёлочку». Бесшовность краёв обеспечивает пайплайн сжатия ассетов
    // (scripts/prepare-ground-textures.js ресайзит с заворотом краёв).
    const useRepeat = isPow2(texture.width) && isPow2(texture.height);
    const wrap = useRepeat ? PIXI.WRAP_MODES.REPEAT : PIXI.WRAP_MODES.CLAMP;
    texture.baseTexture.wrapMode = wrap;
    if (accent) accent.texture.baseTexture.wrapMode = wrap;
    if (lighting) {
        lighting.normal.baseTexture.wrapMode = wrap;
        if (lighting.roughness) lighting.roughness.baseTexture.wrapMode = wrap;
    }

    // POT: аппаратный wrap; NPOT: fract вручную (даёт микро-шов, но выбора нет).
    const uv = useRepeat ? "p" : "fract(p)";
    const hasLight = !!lighting;
    const hasRough = !!(lighting && lighting.roughness);
    const hasWet = !!(lighting && lighting.wetMap);

    // Сэмпл одной ячейки untiling-сетки: своё случайное смещение тайла и,
    // если хеш ячейки попал в долю uAccentMix, — accent-текстура целиком.
    // Карты материала сэмплятся тем же p — рельеф совпадает с цветом.
    // GLSL ES 1.0 не передаёт sampler в функции — блок повторяем текстом.
    const cellSample = (i: string, dx: number, dy: number): string => `
                cell = iuv + vec2(${dx}.0, ${dy}.0);
                p = g + hash2(cell);
                pick = step(hashCell(cell), uAccentMix);
                c${i} = mix(texture2D(uTex, ${uv}), texture2D(uAccent, ${uv}), pick);
                ${hasLight ? `n${i} = texture2D(uNormal, ${uv}).rgb;` : ""}
                ${hasRough ? `r${i} = texture2D(uRough, ${uv}).r;` : ""}`;

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
        uniform sampler2D uTex;
        uniform sampler2D uAccent;
        uniform float uAccentMix; // доля accent-ячеек (0 = выкл)
        uniform vec2 uTiles;
        uniform vec2 uFade;  // uv.x начала и конца растворения (0,0 = выкл)
        uniform vec2 uWave;  // частота и амплитуда (в uv) волнистости кромки
${hasLight ? `        uniform sampler2D uNormal;
        uniform vec3 uLightDir;
        uniform float uAmbient;` : ""}
${hasRough ? "        uniform sampler2D uRough;" : ""}
${hasWet ? `        uniform sampler2D uWet;
        uniform vec4 uWorldRect; // x, y, w, h меша в мире
        uniform vec2 uWorldSize;` : ""}

        vec2 hash2(vec2 p) {
            p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return fract(sin(p) * 43758.5453);
        }

        float hash1(float p) {
            return fract(sin(p * 127.1) * 43758.5453);
        }

        float hashCell(vec2 cell) {
            return fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
        }

        // Гладкий 1D-шум вдоль кромки — волнистая граница биома.
        float edgeNoise(float y) {
            float i = floor(y);
            float f = fract(y);
            float u = f * f * (3.0 - 2.0 * f);
            return mix(hash1(i), hash1(i + 1.0), u);
        }

        void main(void) {
            vec2 g = vUvs * uTiles;
            vec2 iuv = floor(g);
            vec2 b = smoothstep(0.2, 0.8, fract(g));

            vec4 c00; vec4 c10; vec4 c01; vec4 c11;
${hasLight ? "            vec3 n00; vec3 n10; vec3 n01; vec3 n11;" : ""}
${hasRough ? "            float r00; float r10; float r01; float r11;" : ""}
            {
                vec2 cell; vec2 p; float pick;
${cellSample("00", 0, 0)}
${cellSample("10", 1, 0)}
${cellSample("01", 0, 1)}
${cellSample("11", 1, 1)}
            }

            vec4 color = mix(mix(c00, c10, b.x), mix(c01, c11, b.x), b.y);
${hasLight ? `
            // Нормаль: бленд как у цвета, декод из [0,1] в [-1,1].
            // Y инвертирован: у карты (OpenGL) Y вверх, у экрана — вниз.
            vec3 nrm = mix(mix(n00, n10, b.x), mix(n01, n11, b.x), b.y);
            nrm = normalize(vec3(nrm.x * 2.0 - 1.0, -(nrm.y * 2.0 - 1.0), nrm.z));

            vec3 L = normalize(uLightDir);
            float diff = max(dot(nrm, L), 0.0);
            float light = uAmbient + diff * (1.0 - uAmbient);
            color.rgb *= light;

            // Солнечный блик: полувектор (камера строго сверху).
            vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
            float spec = pow(max(dot(nrm, H), 0.0), 24.0);
${hasRough ? `            float rough = mix(mix(r00, r10, b.x), mix(r01, r11, b.x), b.y);
            spec *= (1.0 - rough * 0.85);` : ""}
${hasWet ? `            // Мокрая земля бликует: локальная влажность из карты мира.
            vec2 wetUv = (uWorldRect.xy + vUvs * uWorldRect.zw) / uWorldSize;
            float wet = texture2D(uWet, wetUv).a;
            spec *= (0.08 + 0.92 * wet);` : `            spec *= 0.08;`}
            color.rgb += vec3(1.0, 0.98, 0.9) * spec;` : ""}

            float alpha = 1.0;
            if (uFade.y > 0.0) {
                // два масштаба волн: крупные заливы + мелкая рвань
                float n = (edgeNoise(vUvs.y * uWave.x) - 0.5)
                    + (edgeNoise(vUvs.y * uWave.x * 3.7 + 13.5) - 0.5) * 0.35;
                alpha = 1.0 - smoothstep(uFade.x, uFade.y, vUvs.x + n * uWave.y);
            }

            // premultiplied alpha
            gl_FragColor = vec4(color.rgb * alpha, alpha);
        }
    `;

    const geometry = new PIXI.Geometry()
        .addAttribute("aVertexPosition", [0, 0, width, 0, width, height, 0, height], 2)
        .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
        .addIndex([0, 1, 2, 0, 2, 3]);

    // Волны кромки: период ~500 px, амплитуда ~60% ширины растворения.
    const fadeU = fadeRight / width;
    const uniforms: Record<string, unknown> = {
        uTex: texture,
        uAccent: accent ? accent.texture : texture,
        uAccentMix: accent ? accent.fraction : 0,
        uTiles: [width / texture.width, height / texture.height],
        uFade: fadeRight > 0 ? [1.0 - fadeU * 1.6, 1.0 - fadeU * 0.4] : [0, 0],
        uWave: [height / 500, fadeU * 0.6],
    };
    if (lighting) {
        uniforms.uNormal = lighting.normal;
        // те же параметры света, что у fake-фильтра травы — биомы в одном тоне
        uniforms.uLightDir = [-0.4, -0.6, 0.7];
        uniforms.uAmbient = 0.65;
        if (lighting.roughness) uniforms.uRough = lighting.roughness;
        if (lighting.wetMap) {
            uniforms.uWet = lighting.wetMap;
            uniforms.uWorldRect = lighting.worldRect || [0, 0, width, height];
            uniforms.uWorldSize = lighting.worldSize || [width, height];
        }
    }
    const shader = PIXI.Shader.from(vert, frag, uniforms);

    const mesh = new PIXI.Mesh(geometry, shader as any);
    mesh.interactive = false;
    return mesh;
}

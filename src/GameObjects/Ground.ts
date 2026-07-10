import { Mesh, MeshGeometry, Shader, Texture, UniformGroup } from "pixi.js";

// Редкие вкрапления другой текстуры: доля ячеек untiling-сетки,
// которые целиком рисуются accent-текстурой (камни среди песка и т.п.).
export interface GroundAccent {
    texture: Texture;
    fraction: number; // 0..1, напр. 0.08 = ~8% ячеек
}

// Растворение краёв меша шумной волнистой кромкой (px на каждую сторону):
// так биомы склеиваются органической границей, а не прямой линией.
export interface GroundFade {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
}

// Попиксельное освещение по картам материала (вместо fake-фильтра по яркости).
export interface GroundLighting {
    normal: Texture; // карта нормалей (OpenGL-конвенция, Y вверх)
    roughness?: Texture; // шершавость: гасит блик (1 - rough)
    wetMap?: Texture; // карта влажности мира (WetGround.texture) — мокрое бликует
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
 * остаётся fract-вариант — на WebGL1-фолбэке REPEAT для NPOT недоступен.
 *
 * lighting — честный попиксельный свет: нормали сэмплятся ТЕМИ ЖЕ
 * untiling-смещениями, что и цвет (рельеф не разъезжается с картинкой),
 * диффуз + солнечный блик, который усиливается на мокрой земле (wetMap)
 * и гасится шершавостью (roughness). AO предполагается запечённым в цвет.
 *
 * fade — растворение краёв (число = только правый край, объект = любые
 * стороны): меш кладётся ПОВЕРХ соседнего биома с нахлёстом, кромка шумная.
 */
export function createGroundMesh(
    texture: Texture,
    width: number,
    height: number,
    fade: number | GroundFade = 0,
    accent?: GroundAccent,
    lighting?: GroundLighting
): Mesh<MeshGeometry, Shader> {
    // NB: не mirror-repeat — на направленных текстурах (дюны) зеркалка
    // даёт «ёлочку». Бесшовность краёв обеспечивает пайплайн сжатия ассетов
    // (scripts/prepare-ground-textures.js ресайзит с заворотом краёв).
    const useRepeat = isPow2(texture.width) && isPow2(texture.height);
    const address = useRepeat ? "repeat" : "clamp-to-edge";
    texture.source.style.addressMode = address;
    if (accent) accent.texture.source.style.addressMode = address;
    if (lighting) {
        lighting.normal.source.style.addressMode = address;
        if (lighting.roughness) lighting.roughness.source.style.addressMode = address;
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
                ${hasLight ? `n${i} = texture2D(uNormalMap, ${uv}).rgb;` : ""}
                ${hasRough ? `r${i} = texture2D(uRoughMap, ${uv}).r;` : ""}`;

    const vert = `
        attribute vec2 aPosition;
        attribute vec2 aUV;
        uniform mat3 uProjectionMatrix;
        uniform mat3 uWorldTransformMatrix;
        uniform mat3 uTransformMatrix;
        varying vec2 vUvs;
        void main(void) {
            vUvs = aUV;
            mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
            gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
        }
    `;

    const frag = `
        precision highp float;
        varying vec2 vUvs;
        uniform sampler2D uTex;
        uniform sampler2D uAccent;
        uniform float uAccentMix; // доля accent-ячеек (0 = выкл)
        uniform vec2 uTiles;
        uniform vec4 uFadeW;    // ширина растворения в uv: left, right, top, bottom (0 = выкл)
        uniform vec2 uWaveFreq; // частота волн кромки: .x — вдоль y (бока), .y — вдоль x (верх/низ)
${hasLight ? `        uniform sampler2D uNormalMap;
        uniform vec3 uLightDir;
        uniform float uAmbient;` : ""}
${hasRough ? "        uniform sampler2D uRoughMap;" : ""}
${hasWet ? `        uniform sampler2D uWetMap;
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

        // Два масштаба волн: крупные заливы + мелкая рвань. seed — чтобы
        // соседние края одного меша не повторяли рисунок друг друга.
        float edgeWave(float t, float seed) {
            return (edgeNoise(t + seed) - 0.5)
                + (edgeNoise(t * 3.7 + seed + 13.5) - 0.5) * 0.35;
        }

        // d — расстояние от края в uv, w — ширина растворения (uv).
        float edgeFade(float d, float w, float n) {
            return w > 0.0 ? smoothstep(w * 0.4, w * 1.6, d + n * w * 0.6) : 1.0;
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
${hasWet ? `            // Мокрая земля бликует: локальная влажность из карты мира
            // (карта хранит «светлость»: белое = сухо → wet = 1 - r).
            vec2 wetUv = (uWorldRect.xy + vUvs * uWorldRect.zw) / uWorldSize;
            float wet = 1.0 - texture2D(uWetMap, wetUv).r;
            spec *= (0.08 + 0.92 * wet);` : `            spec *= 0.08;`}
            color.rgb += vec3(1.0, 0.98, 0.9) * spec;` : ""}

            float nSide = edgeWave(vUvs.y * uWaveFreq.x, 0.0);
            float nFlat = edgeWave(vUvs.x * uWaveFreq.y, 71.0);
            float alpha = edgeFade(vUvs.x, uFadeW.x, edgeWave(vUvs.y * uWaveFreq.x, 37.0))
                * edgeFade(1.0 - vUvs.x, uFadeW.y, nSide)
                * edgeFade(vUvs.y, uFadeW.z, nFlat)
                * edgeFade(1.0 - vUvs.y, uFadeW.w, edgeWave(vUvs.x * uWaveFreq.y, 108.0));

            // premultiplied alpha
            gl_FragColor = vec4(color.rgb * alpha, alpha);
        }
    `;

    const geometry = new MeshGeometry({
        positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });

    // Волны кромки: период ~500 px, амплитуда ~60% ширины растворения.
    const f: GroundFade = typeof fade === "number" ? { right: fade } : fade;
    const groundUniforms = new UniformGroup({
        uAccentMix: { value: accent ? accent.fraction : 0, type: "f32" },
        uTiles: {
            value: new Float32Array([width / texture.width, height / texture.height]),
            type: "vec2<f32>",
        },
        uFadeW: {
            value: new Float32Array([
                (f.left || 0) / width,
                (f.right || 0) / width,
                (f.top || 0) / height,
                (f.bottom || 0) / height,
            ]),
            type: "vec4<f32>",
        },
        uWaveFreq: {
            value: new Float32Array([height / 500, width / 500]),
            type: "vec2<f32>",
        },
        ...(lighting
            ? {
                  // те же параметры света, что у fake-фильтра травы — биомы в одном тоне
                  uLightDir: { value: new Float32Array([-0.4, -0.6, 0.7]), type: "vec3<f32>" },
                  uAmbient: { value: 0.65, type: "f32" },
                  ...(lighting.wetMap
                      ? {
                            uWorldRect: {
                                value: new Float32Array(
                                    lighting.worldRect || [0, 0, width, height]
                                ),
                                type: "vec4<f32>",
                            },
                            uWorldSize: {
                                value: new Float32Array(
                                    lighting.worldSize || [width, height]
                                ),
                                type: "vec2<f32>",
                            },
                        }
                      : {}),
              }
            : {}),
    });

    const resources: Record<string, unknown> = {
        groundUniforms,
        uTex: texture.source,
        uAccent: (accent ? accent.texture : texture).source,
    };
    if (lighting) {
        resources.uNormalMap = lighting.normal.source;
        if (lighting.roughness) resources.uRoughMap = lighting.roughness.source;
        if (lighting.wetMap) resources.uWetMap = lighting.wetMap.source;
    }

    const shader = Shader.from({ gl: { vertex: vert, fragment: frag }, resources });

    const mesh = new Mesh<MeshGeometry, Shader>({ geometry, shader });
    mesh.eventMode = "none";
    return mesh;
}

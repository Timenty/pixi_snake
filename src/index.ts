import * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";

import lowPolyGrass from "./assets/background/low_poly_grass.png";
import sandColorJpg from "./assets/background/sand_color.jpg";
import sandNormalJpg from "./assets/background/sand_normal.jpg";
import sandRoughJpg from "./assets/background/sand_rough.jpg";

import { Snake } from "./GameObjects/Snake";
import { Food } from "./GameObjects/Food";
import { CloudShadows, TreeShadows } from "./GameObjects/CloudShadows";
import { createGroundMesh } from "./GameObjects/Ground";
import { Rain } from "./GameObjects/Rain";
import { WetGround } from "./GameObjects/WetGround";
import { Weather, WeatherKind } from "./GameObjects/Weather";
import {
    generateSkin,
    loadSkinOptions,
    saveSkinOptions,
    SkinTextures,
} from "./GameObjects/SnakeSkin";
import { SkinPanel } from "./UI/SkinPanel";
import { JoyStick } from "./Controls/JoyStick";
import { Keyboard } from "./Controls/Keyboard";
import * as logic from "./Physics/Vectors";
import { ControlVector } from "./ObjectTypes/ControlVector";
import { Controller as IController } from "./Controls/IController";

// Карта из двух биомов: песок слева, трава справа. Стык — волнистая кромка.
const SAND_WIDTH = 4500;
const GRASS_WIDTH = 9000;
const WORLD_WIDTH = SAND_WIDTH + GRASS_WIDTH;
const WORLD_HEIGHT = 9000;

export class Main {
    private app: PIXI.Application | undefined;
    private viewport: Viewport | undefined;
    // Создаётся в createRenderer: карта влажности нужна шейдеру песка (блик).
    private wetGround: WetGround | undefined;

    public async start(): Promise<void> {
        await PIXI.Assets.load([
            { alias: "tileGrass", src: lowPolyGrass },
            { alias: "tileSand", src: sandColorJpg },
            { alias: "sandNormal", src: sandNormalJpg },
            { alias: "sandRough", src: sandRoughJpg },
        ]);
        await this.createRenderer();
        this.buildGame();
    }

    private buildGame(): void {
        const stage: PIXI.Container = this.app!.stage;
        const viewport = this.viewport!;

        // Кожа змейки: генерируется из настроек (localStorage), меняется на лету.
        const skinOpts = loadSkinOptions();
        let skinTex: SkinTextures = generateSkin(skinOpts);
        const snake: Snake = new Snake(viewport, skinTex);
        snake.setWorldBounds(viewport.worldWidth, viewport.worldHeight);

        new SkinPanel(skinOpts, opts => {
            saveSkinOptions(opts);
            const fresh = generateSkin(opts);
            snake.setSkin(fresh);
            // Старые canvas-текстуры больше никем не используются — чистим GPU-память.
            skinTex.head.destroy(true);
            skinTex.body.destroy(true);
            skinTex = fresh;
        });

        const FOOD_COUNT = 40;
        const MAX_FOODS = 120; // потолок вместе с дропами от самоукуса
        const foods: Food[] = [];
        for (let i = 0; i < FOOD_COUNT; i++) {
            const food = new Food(viewport.worldWidth, viewport.worldHeight);
            viewport.addChild(food.model);
            foods.push(food);
        }

        // Слой эффектов поверх еды и змейки.
        const fxLayer = new PIXI.Container();
        viewport.addChild(fxLayer);

        // Погода: тени облаков и дождь — в мировых координатах (в viewport,
        // поверх змейки и еды): дождь привязан к поверхности, а не к камере.
        // Начальное состояние можно задать через ?weather=sunny|overcast|sunshower.
        const clouds = new CloudShadows(viewport.worldWidth, viewport.worldHeight);
        viewport.addChild(clouds.mesh);
        // Тестовая роща: статичные тени крон в нижнем левом углу ТРАВЯНОЙ части
        // (левее — песок, там кронам не место).
        // Меш имеет внутренний запас 1000px — позицию сдвигаем с его учётом.
        const TREES_SIZE = 2600;
        const trees = new TreeShadows(TREES_SIZE, TREES_SIZE);
        trees.mesh.position.set(SAND_WIDTH - 1000, viewport.worldHeight - TREES_SIZE - 1000);
        viewport.addChild(trees.mesh);

        const rain = new Rain();
        viewport.addChild(rain.container); // капли над тенями облаков
        // Капли летят туда же, куда дрейфуют облака (визуально — против uWind).
        rain.setWindDirection(-Math.sign(clouds.windVector[0]));

        // Мокрая почва (создана в createRenderer): тёмные пятна там, куда
        // упали капли. Слой сразу над землёй (index 1), под змейкой/едой.
        const wetGround = this.wetGround!;
        viewport.addChildAt(wetGround.overlay, 1);
        // Влагу кладёт «виртуальный дождь» по всей карте (см. ticker) —
        // видимые капли у камеры её не дублируют.

        const urlWeather = new URLSearchParams(window.location.search).get("weather");
        const initialWeather: WeatherKind =
            urlWeather === "overcast" || urlWeather === "sunshower" ? urlWeather : "sunny";
        const weather = new Weather(clouds, rain, initialWeather);
        // Дебаг-хендл: потрогать погоду из консоли (window.__game).
        (window as any).__game = { weather, clouds, rain, wetGround, trees, snake, viewport };
        const rings: Array<{ g: PIXI.Graphics; life: number; color: number }> = [];
        const floaters: Array<{ t: PIXI.Text; life: number }> = [];

        const spawnEatFx = (x: number, y: number, value: number, golden: boolean): void => {
            const g = new PIXI.Graphics();
            g.position.set(x, y);
            fxLayer.addChild(g);
            rings.push({ g, life: 0, color: golden ? 0xffd54a : 0xffffff });

            const t = new PIXI.Text({
                text: `+${value}`,
                style: {
                    fontFamily: "Arial",
                    fontSize: 110,
                    fontWeight: "bold",
                    fill: golden ? 0xffd54a : 0xffffff,
                    stroke: { color: 0x000000, width: 8 },
                },
            });
            t.anchor.set(0.5);
            t.position.set(x, y - 60);
            fxLayer.addChild(t);
            floaters.push({ t, life: 0 });
        };

        // Счёт и рекорд — на stage, фиксированы к экрану (не зумятся с viewport).
        let score = 0;
        let best = Number(localStorage.getItem("pixi-snake-best") || 0);
        const scoreText = new PIXI.Text({
            text: "Очки: 0",
            style: {
                fontFamily: "Arial",
                fontSize: 32,
                fill: 0xffffff,
                stroke: { color: 0x000000, width: 4 },
            },
        });
        scoreText.position.set(20, 20);
        stage.addChild(scoreText);

        const bestText = new PIXI.Text({
            text: `Рекорд: ${best}`,
            style: {
                fontFamily: "Arial",
                fontSize: 22,
                fill: 0xffe08a,
                stroke: { color: 0x000000, width: 3 },
            },
        });
        bestText.position.set(20, 62);
        stage.addChild(bestText);

        const hintText = new PIXI.Text({
            text: "WASD / стрелки / джойстик — движение · Shift — ускорение · V — погода",
            style: {
                fontFamily: "Arial",
                fontSize: 16,
                fill: 0xffffff,
                stroke: { color: 0x000000, width: 3 },
            },
        });
        hintText.alpha = 0.65;
        hintText.position.set(20, 96);
        stage.addChild(hintText);

        // FPS: обновляем текст пару раз в секунду, чтобы сам счётчик не мельтешил.
        const fpsText = new PIXI.Text({
            text: "FPS: —",
            style: {
                fontFamily: "Arial",
                fontSize: 14,
                fill: 0xa8ffb0,
                stroke: { color: 0x000000, width: 3 },
            },
        });
        fpsText.alpha = 0.8;
        fpsText.position.set(20, 122);
        stage.addChild(fpsText);
        let fpsTimer = 0;

        const setScore = (n: number): void => {
            score = n;
            scoreText.text = `Очки: ${score}`;
            if (score > best) {
                best = score;
                bestText.text = `Рекорд: ${best}`;
                localStorage.setItem("pixi-snake-best", String(best));
            }
        };

        // Два контроллера пишут в одно место: активен тот, кого трогали последним.
        const controllers: IController[] = [new JoyStick(), new Keyboard()];
        for (const controller of controllers) {
            controller.subscribe(function (vector: ControlVector) {
                snake.directionSet = vector;
            });
        }

        // Клавиша "C" — переключить отображение коллайдера змейки.
        // Клавиша "V" — следующая погода (дебаг: солнечно → пасмурно → слепой дождь).
        window.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "c" || e.key === "C" || e.key === "с" || e.key === "С") {
                snake.toggleCollider();
            }
            if (e.key === "v" || e.key === "V" || e.key === "м" || e.key === "М") {
                console.log("weather:", weather.cycle());
            }
        });

        const MAGNET_RADIUS = 350; // еда подтягивается к голове с этого расстояния
        const EAT_PADDING = 60; // насколько «широк» рот относительно радиуса еды

        this.app!.ticker.add((ticker: PIXI.Ticker) => {
            const delta = ticker.deltaTime;
            fpsTimer += delta;
            if (fpsTimer >= 30) {
                fpsTimer = 0;
                fpsText.text = `FPS: ${Math.round(ticker.FPS)}`;
            }
            weather.update(delta, viewport.getVisibleBounds());
            trees.update(delta); // лёгкое «дыхание» крон
            snake.setWetness(weather.wetness);
            wetGround.rainOverWorld(delta, rain.intensity); // мокнет вся карта
            wetGround.update(delta, rain.intensity < 0.03); // без дождя — сохнет
            snake.move();
            snake.drawCollider();
            const head = snake.headWorld;
            const headPoint = new PIXI.Point(head.x, head.y);

            // Еда: магнит → поедание. Дропы после поедания исчезают, остальное респавнится.
            for (let i = foods.length - 1; i >= 0; i--) {
                const food = foods[i];
                food.update(delta);
                const distance = logic.distanceBetweenPoints(headPoint, food.position);

                if (distance < food.radius + EAT_PADDING) {
                    snake.grow(food.kind === "golden" ? 9 : 3);
                    setScore(score + food.value);
                    spawnEatFx(food.position.x, food.position.y, food.value, food.kind === "golden");
                    if (food.kind === "drop") {
                        viewport.removeChild(food.model);
                        foods.splice(i, 1);
                    } else {
                        food.respawn();
                    }
                } else if (distance < MAGNET_RADIUS) {
                    // Притяжение сильнее вблизи: 0 на краю радиуса → max у головы.
                    const pull = (1 - distance / MAGNET_RADIUS) * 9 * delta;
                    food.position.x += ((head.x - food.position.x) / distance) * pull;
                    food.position.y += ((head.y - food.position.y) / distance) * pull;
                }
            }

            // Самоукус: отрезанный хвост рассыпается едой на месте среза.
            const bitten = snake.selfBite();
            if (bitten.length > 0) {
                setScore(Math.max(0, score - Math.floor(bitten.length / 3))); // 3 секции = 1 еда
                for (let i = 0; i < bitten.length && foods.length < MAX_FOODS; i += 3) {
                    const drop = new Food(viewport.worldWidth, viewport.worldHeight);
                    drop.becomeDrop(
                        bitten[i].x + (Math.random() - 0.5) * 60,
                        bitten[i].y + (Math.random() - 0.5) * 60
                    );
                    viewport.addChild(drop.model);
                    foods.push(drop);
                }
            }

            // Эффекты: расходящееся кольцо и всплывающий "+N".
            for (let i = rings.length - 1; i >= 0; i--) {
                const ring = rings[i];
                ring.life += delta;
                const t = ring.life / 25;
                if (t >= 1) {
                    fxLayer.removeChild(ring.g);
                    rings.splice(i, 1);
                    continue;
                }
                ring.g.clear();
                ring.g.circle(0, 0, 40 + t * 160).stroke({
                    width: 10 * (1 - t),
                    color: ring.color,
                    alpha: 1 - t,
                });
            }
            for (let i = floaters.length - 1; i >= 0; i--) {
                const f = floaters[i];
                f.life += delta;
                f.t.y -= 2.5 * delta;
                f.t.alpha = 1 - f.life / 45;
                if (f.life >= 45) {
                    fxLayer.removeChild(f.t);
                    floaters.splice(i, 1);
                }
            }

            // Камера: чем длиннее змейка, тем дальше отъезжает зум (плавно).
            // Нижний предел зума — чтобы мир не стал меньше экрана (иначе серые поля).
            const minZoom = Math.max(
                0.15,
                window.innerWidth / viewport.worldWidth,
                window.innerHeight / viewport.worldHeight
            );
            const targetZoom = Math.min(0.25, Math.max(minZoom, 0.25 - (snake.length - 30) * 0.0006));
            const currentZoom = viewport.scaled;
            viewport.setZoom(currentZoom + (targetZoom - currentZoom) * 0.02, true);

            viewport.follow(
                // follow читает только x/y — полноценный Container не нужен
                {
                    x: head.x,
                    y: head.y,
                } as unknown as PIXI.Container,
                {
                    speed: 20,
                    radius: 150,
                }
            );
        });
    }

    private async createRenderer(): Promise<void> {
        this.app = new PIXI.Application();
        await this.app.init({
            resizeTo: window,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true, // high-DPI экраны
            backgroundColor: 0xf3f3f3,
            antialias: false,
        });

        document.body.appendChild(this.app.canvas);

        this.viewport = new Viewport({
            screenWidth: window.innerWidth,
            screenHeight: window.innerHeight,
            worldWidth: WORLD_WIDTH,
            worldHeight: WORLD_HEIGHT,
            events: this.app.renderer.events,
        });
        this.viewport.setZoom(0.25);
        // Камера не выходит за пределы мира — у краёв не видно «серую пустоту».
        this.viewport.clamp({ direction: "all" });

        this.app.stage.addChild(this.viewport);

        // Карта влажности — до мешей земли: шейдер песка сэмплит её для блика.
        this.wetGround = new WetGround(this.app.renderer, WORLD_WIDTH, WORLD_HEIGHT);

        // Фон из двух биомов (шейдер «untiling» — см. Ground.ts):
        // трава занимает правую часть и заходит под песок; песок лежит сверху
        // и растворяется вправо волнистой шумной кромкой — органичный стык.
        const qH = WORLD_HEIGHT + 1000;
        const background = new PIXI.Container();
        background.eventMode = "none";

        const SEAM_OVERLAP = 800; // насколько песок заходит на траву
        const grassX = SAND_WIDTH - SEAM_OVERLAP - 500;
        const grass = createGroundMesh(
            PIXI.Assets.get("tileGrass"),
            WORLD_WIDTH + 500 - grassX,
            qH
        );
        grass.position.set(grassX, -500);
        background.addChild(grass);

        // Песок освещается честно: нормали + roughness + мокрый блик из
        // карты влажности (AO запечён в цвет скриптом подготовки текстур).
        const sandW = SAND_WIDTH + SEAM_OVERLAP + 500;
        const sand = createGroundMesh(
            PIXI.Assets.get("tileSand"),
            sandW,
            qH,
            900, // ширина растворения правого края
            undefined,
            {
                normal: PIXI.Assets.get("sandNormal"),
                roughness: PIXI.Assets.get("sandRough"),
                wetMap: this.wetGround.texture,
                worldRect: [-500, -500, sandW, qH],
                worldSize: [WORLD_WIDTH, WORLD_HEIGHT],
            }
        );
        sand.position.set(-500, -500);
        background.addChild(sand); // поверх травы — кромка песка её перекрывает

        this.viewport.addChild(background);

        // Псевдо-3D объём травы: нормали выводим из самой текстуры (height = яркость),
        // освещаем направленным светом. Отдельная normal-map не нужна.
        const grassLightFrag = `
            precision highp float;
            varying vec2 vTextureCoord;
            uniform sampler2D uTexture;
            uniform vec4 uInputSize;  // .xy = размер входа в пикселях (даёт PIXI)
            uniform vec3 uLightDir;   // направление света
            uniform float uStrength;  // сила рельефа
            uniform float uAmbient;   // фоновая засветка

            float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

            void main(void) {
                vec2 texel = 1.0 / uInputSize.xy;
                vec4 color = texture2D(uTexture, vTextureCoord);

                float hL = lum(texture2D(uTexture, vTextureCoord - vec2(texel.x, 0.0)).rgb);
                float hR = lum(texture2D(uTexture, vTextureCoord + vec2(texel.x, 0.0)).rgb);
                float hU = lum(texture2D(uTexture, vTextureCoord - vec2(0.0, texel.y)).rgb);
                float hD = lum(texture2D(uTexture, vTextureCoord + vec2(0.0, texel.y)).rgb);

                vec3 normal = normalize(vec3((hL - hR) * uStrength, (hU - hD) * uStrength, 1.0));
                float diff = max(dot(normal, normalize(uLightDir)), 0.0);
                float light = uAmbient + diff * (1.0 - uAmbient);

                gl_FragColor = vec4(color.rgb * light, color.a);
            }
        `;
        const grassLight = PIXI.Filter.from({
            gl: { vertex: PIXI.defaultFilterVert, fragment: grassLightFrag },
            resources: {
                lightUniforms: {
                    uLightDir: {
                        value: new Float32Array([-0.4, -0.6, 0.7]), // свет сверху-слева
                        type: "vec3<f32>",
                    },
                    uStrength: { value: 10.0, type: "f32" },
                    uAmbient: { value: 0.65, type: "f32" },
                },
            },
        });
        // Только трава: у песка честный попиксельный свет в собственном шейдере,
        // fake-рельеф из яркости ему не нужен (и не должен применяться дважды).
        // NB: filterArea не задаём — v8 сам ограничивает фильтр видимой областью.
        grass.filters = [grassLight];

        window.addEventListener("resize", this.onResize.bind(this));

        this.makeEndMarkers();
    }

    private onResize(): void {
        if (!this.app) {
            return;
        }

        this.app.renderer.resize(window.innerWidth, window.innerHeight);
    }

    private makeEndMarkers(): void {
        const height = this.viewport!.worldHeight;
        const width = this.viewport!.worldWidth;
        const pointSize = 100;
        const markers = [
            { tint: 0xee8aff, size: pointSize, position: [width - pointSize, height - pointSize] },
            { tint: 0xee8aff, size: pointSize, position: [0, height - pointSize] },
            { tint: 0xee8aff, size: pointSize, position: [0, 0] },
            { tint: 0xee8aff, size: pointSize, position: [width - pointSize, 0] },
        ];

        for (let index = 0; index < markers.length; index++) {
            const markerSettings = markers[index];
            const marker: PIXI.Sprite = this.viewport!.addChild(
                new PIXI.Sprite(PIXI.Texture.WHITE)
            );
            marker.eventMode = "none";
            marker.tint = markerSettings.tint;
            marker.width = marker.height = markerSettings.size;
            marker.position.set(markerSettings.position[0], markerSettings.position[1]);
        }
    }
}

new Main().start().catch(e => console.error("game boot failed:", e));

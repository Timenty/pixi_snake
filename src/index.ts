import * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";

import rabbitImage from "./assets/rabbit.png";
import lowPolyGrass from "./assets/background/low_poly_grass.png";
import snakeImage from "./assets/snake.png";

import { Snake } from "./GameObjects/Snake";
import { Food } from "./GameObjects/Food";
import { JoyStick } from "./Controls/JoyStick";
import * as logic from "./Physics/Vectors";
import { ControlVector } from "./ObjectTypes/ControlVector";
import { Controller as IController } from "./Controls/IController";

export class Main {
    private app: PIXI.Application | undefined;
    private viewport: Viewport | undefined;

    constructor() {
        window.onload = (): void => {
            this.startLoadingAssets();
        };
    }

    private startLoadingAssets(): void {
        const loader: PIXI.Loader = PIXI.Loader.shared;

        loader.add("snake", snakeImage);
        loader.add("tileGrass", lowPolyGrass);
        // loader.add("spriteExample", "./spritesData.json"); // example of loading spriteSheet
        loader.onComplete.add((): void => {
            console.log('complete');
            this.onAssetsLoaded();
        });

        loader.load();
    }

    private onAssetsLoaded(): void {
        this.createRenderer();


        const stage: PIXI.Container = this.app!.stage;

        const snake: Snake = new Snake(this.viewport!);

        // console.log(snake);

        const FOOD_COUNT = 40;
        const foods: Food[] = [];
        for (let i = 0; i < FOOD_COUNT; i++) {
            const food = new Food(
                this.viewport!.worldWidth,
                this.viewport!.worldHeight
            );
            this.viewport!.addChild(food.model);
            foods.push(food);
        }

        // Счётчик очков — на stage, фиксирован к экрану (не зумится с viewport).
        let score = 0;
        const scoreText: PIXI.Text = new PIXI.Text("Очки: 0", {
            fontFamily: "Arial",
            fontSize: 32,
            fill: 0xffffff,
            stroke: 0x000000,
            strokeThickness: 4,
        });
        scoreText.position.set(20, 20);
        stage.addChild(scoreText);

        const controller: IController = new JoyStick();

        controller.subscribe(function (vector: ControlVector) {
            // console.log('vector', vector);
            // snake.direction = vector;
            snake.directionSet = vector;
        });

        // Клавиша "C" — переключить отображение коллайдера змейки.
        window.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "c" || e.key === "C" || e.key === "с" || e.key === "С") {
                snake.toggleCollider();
            }
        });

        this.app.ticker.add(data => {
            snake.move();
            snake.drawCollider();
            const head = snake.headWorld;

            const headPoint = new PIXI.Point(head.x, head.y);
            for (const food of foods) {
                const distance = logic.distanceBetweenPoints(headPoint, food.position);
                if (distance < food.radius + 60) {
                    snake.grow(3);
                    score++;
                    scoreText.text = `Очки: ${score}`;
                    food.respawn();
                }
            }

            const bitten = snake.selfBite();
            if (bitten > 0) {
                score = Math.max(0, score - Math.floor(bitten / 3)); // 3 секции = 1 еда
                scoreText.text = `Очки: ${score}`;
            }

            this.viewport?.follow({
                x: head.x,
                y: head.y
            }, {
                speed: 20,
                radius: 150,
            });
        });

    }

    private createRenderer(): void {
        PIXI.settings.RESOLUTION = window.devicePixelRatio || 1;

        this.app = new PIXI.Application({
            resizeTo: window,
            autoDensity: true, // Handles high DPI screens
            backgroundColor: 0xf3f3f3,
            antialias: false,
        });

        // console.log('app', this.app);
        document.body.appendChild(this.app.view);

        this.viewport = new Viewport({
            screenWidth: window.innerWidth,
            screenHeight: window.innerHeight,
            worldWidth: 9000,
            worldHeight: 9000,
            // the interaction module is important for wheel to work properly when renderer.view is placed or scaled
            interaction: this.app.renderer.plugins.interaction,
        });
        this.viewport.setZoom(0.25)

        // console.log('this.viewport', this.viewport);
        // console.log('this.app.renderer', this.app.renderer);
        this.app!.stage.addChild(this.viewport);

        // Фон-трава мешем с шейдером «untiling»: тайлим текстуру, но каждую ячейку
        // сэмплим со случайным (по хешу) смещением и плавно блендим 4 соседних —
        // видимые повторы тайла исчезают, швов нет (техника Inigo Quilez).
        const qW = this.viewport.worldWidth + 1000;
        const qH = this.viewport.worldHeight + 1000;
        const grassTex = PIXI.Texture.from("tileGrass");
        const tilesX = qW / grassTex.width;
        const tilesY = qH / grassTex.height;

        const grassVert = `
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
        const grassTileFrag = `
            precision highp float;
            varying vec2 vUvs;
            uniform sampler2D uGrass;
            uniform vec2 uTiles;

            vec2 hash2(vec2 p) {
                p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
                return fract(sin(p) * 43758.5453);
            }

            void main(void) {
                vec2 g = vUvs * uTiles;
                vec2 iuv = floor(g);
                vec2 b = smoothstep(0.2, 0.8, fract(g));

                vec2 o00 = hash2(iuv + vec2(0.0, 0.0));
                vec2 o10 = hash2(iuv + vec2(1.0, 0.0));
                vec2 o01 = hash2(iuv + vec2(0.0, 1.0));
                vec2 o11 = hash2(iuv + vec2(1.0, 1.0));

                vec4 c00 = texture2D(uGrass, fract(g + o00));
                vec4 c10 = texture2D(uGrass, fract(g + o10));
                vec4 c01 = texture2D(uGrass, fract(g + o01));
                vec4 c11 = texture2D(uGrass, fract(g + o11));

                gl_FragColor = mix(mix(c00, c10, b.x), mix(c01, c11, b.x), b.y);
            }
        `;
        const grassGeometry = new PIXI.Geometry()
            .addAttribute("aVertexPosition", [0, 0, qW, 0, qW, qH, 0, qH], 2)
            .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);
        const grassShader = PIXI.Shader.from(grassVert, grassTileFrag, {
            uGrass: grassTex,
            uTiles: [tilesX, tilesY],
        });
        const background = new PIXI.Mesh(grassGeometry, grassShader as any);
        background.interactive = false;
        background.position.set(-500, -500);

        this.viewport.addChild(background);

        // Псевдо-3D объём травы: нормали выводим из самой текстуры (height = яркость),
        // освещаем направленным светом. Отдельная normal-map не нужна.
        const grassLightFrag = `
            precision highp float;
            varying vec2 vTextureCoord;
            uniform sampler2D uSampler;
            uniform vec4 inputSize;   // .xy = размер входа в пикселях (даёт PIXI)
            uniform vec3 uLightDir;   // направление света
            uniform float uStrength;  // сила рельефа
            uniform float uAmbient;   // фоновая засветка

            float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

            void main(void) {
                vec2 texel = 1.0 / inputSize.xy;
                vec4 color = texture2D(uSampler, vTextureCoord);

                float hL = lum(texture2D(uSampler, vTextureCoord - vec2(texel.x, 0.0)).rgb);
                float hR = lum(texture2D(uSampler, vTextureCoord + vec2(texel.x, 0.0)).rgb);
                float hU = lum(texture2D(uSampler, vTextureCoord - vec2(0.0, texel.y)).rgb);
                float hD = lum(texture2D(uSampler, vTextureCoord + vec2(0.0, texel.y)).rgb);

                vec3 normal = normalize(vec3((hL - hR) * uStrength, (hU - hD) * uStrength, 1.0));
                float diff = max(dot(normal, normalize(uLightDir)), 0.0);
                float light = uAmbient + diff * (1.0 - uAmbient);

                gl_FragColor = vec4(color.rgb * light, color.a);
            }
        `;
        const grassLight = new PIXI.Filter(undefined, grassLightFrag, {
            uLightDir: [-0.4, -0.6, 0.7], // свет сверху-слева (top-down)
            uStrength: 10.0,
            uAmbient: 0.65,
        });
        background.filters = [grassLight];
        background.filterArea = this.app.renderer.screen; // фильтр только по экрану (перф)

        // возможно нужны будут следующие настройки, а может выпилить
        // this.viewport
            // .drag()
            // .pinch()
            // .wheel()
            // Настройки во время игры
            // .clampZoom({
            //     minHeight: 650,
            //     minWidth: 1000,
            //     maxWidth: 2200,
            //     maxHeight: 2200,
            // })
            // .bounce()
            // .decelerate();
        // this.app.renderer.resize(window.innerWidth, window.innerHeight);
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
        console.log("makeEndMarkers");
        const height = this.viewport!.worldHeight;
        const width = this.viewport!.worldWidth;
        const pointSize = 100;
        const markers = [
            {
                tint: 0xee8aff,
                size: pointSize,
                position: [width - pointSize, height - pointSize],
            },
            {
                tint: 0xee8aff,
                size: pointSize,
                position: [0, height - pointSize],
            },
            {
                tint: 0xee8aff,
                size: pointSize,
                position: [0, 0],
            },
            {
                tint: 0xee8aff,
                size: pointSize,
                position: [width - pointSize, 0],
            },
        ];

        for (let index = 0; index < markers.length; index++) {
            const markerSettings = markers[index];
            const marker: PIXI.Sprite = this.viewport!.addChild(
                new PIXI.Sprite(PIXI.Texture.WHITE)
            );
            marker.interactive = false;
            marker.tint = markerSettings.tint; // голубой цвет
            marker.width = marker.height = markerSettings.size;
            marker.position.set(...markerSettings.position);
        }
    }
}

new Main();

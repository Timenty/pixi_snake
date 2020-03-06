import * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";

import rabbitImage from "./assets/rabbit.png";
import lowPolyGrass from "./assets/background/low_poly_grass.png";
import snakeImage from "./assets/snake.png";

import { Snake } from "./GameObjects/Snake";
import { JoyStick } from "./Controls/JoyStick";
import { ControlVector } from "./ObjectTypes/ControlVector";
import { Controller as IController } from "./Controls/IController";

export class Main {
    private static readonly GAME_WIDTH: number = 800;
    private static readonly GAME_HEIGHT: number = 600;

    private app: PIXI.Application | undefined;
    private viewport: Viewport | undefined;

    constructor() {
        window.onload = (): void => {
            this.startLoadingAssets();
        };
    }

    // add for the test example purpose
    public helloWorld(): string {
        return "hello world";
    }

    private startLoadingAssets(): void {
        const loader: PIXI.Loader = PIXI.Loader.shared;
        loader.add("rabbit", rabbitImage);
        loader.add("snake", snakeImage);
        loader.add("tileGrass", lowPolyGrass);
        loader.add("spriteExample", "./spritesData.json"); // example of loading spriteSheet

        loader.on("complete", (): void => {
            this.onAssetsLoaded();
        });

        loader.load();
    }

    private onAssetsLoaded(): void {
        this.createRenderer();

        const stage: PIXI.Container = this.app!.stage;

        const snake: Snake = new Snake();
        snake.model.x = 1000;
        snake.model.y = 1000;
        console.log(snake);

        this.viewport?.addChild(snake.model);

        const controller: IController = new JoyStick();

        controller.subscribe(function(vector: ControlVector) {
            snake.moveDirection(vector);
        });
    }

    private createRenderer(): void {
        this.app = new PIXI.Application({
            backgroundColor: 0xf3f3f3,
            antialias: false
        });

        document.body.appendChild(this.app.view);

        this.viewport = new Viewport({
            screenWidth: window.innerWidth,
            screenHeight: window.innerHeight,
            worldWidth: 9000,
            worldHeight: 9000,

            // the interaction module is important for wheel to work properly when renderer.view is placed or scaled
            interaction: this.app.renderer.plugins.interaction, 
        });
        this.app!.stage.addChild(this.viewport);

        const background: PIXI.TilingSprite = new PIXI.TilingSprite(
            PIXI.Texture.from("tileGrass"),
            this.viewport.worldWidth + 1000,
            this.viewport.worldHeight + 1000
        );

        background.interactive = false;
        background.position.set(-500, -500);

        this.viewport.addChild(background);

        this.viewport
            .drag()
            .pinch()
            .wheel()
            // Настройки во время игры
            // .clampZoom({
            //     minHeight: 650,
            //     minWidth: 1000,
            //     maxWidth: 2200,
            //     maxHeight: 2200,
            // })
            .bounce()
            .decelerate();

        this.app.renderer.resize(window.innerWidth, window.innerHeight);
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

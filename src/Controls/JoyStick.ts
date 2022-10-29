import nipplejs from "nipplejs";
import { Controller } from "./IController";
import { ControlVector } from "../ObjectTypes/ControlVector";
import { distanceBetweenPoints } from "../Physics/Vectors";
import { Point } from "pixi.js";

import "joypad.js";

export class JoyStick implements Controller {
    private manager: nipplejs.JoystickManager;
    private subscribers: Array<Function>;
    // private forceSensivity:
    constructor() {
        joypad.on('connect', (e: any) => {
            joypad.set({
                axisMovementThreshold: 0.2
            });
            const { id } = e.gamepad;
            // console.log(`${id} connected!`);
            joypad.on('button_press', (e: any) => {
                const { buttonName } = e.detail;
                // console.log(`${buttonName} was pressed!`);
            });
            joypad.on('axis_move', (e: any) => {
                const { axes } = e.detail.gamepad;
                // console.log(`axis: ${axis} axisValue: ${axisMovementValue}`);
                const newEv = {
                    vector:  {
                        x: axes[0],
                        y: -axes[1]
                    },
                    force: distanceBetweenPoints(new Point(0, 0), new Point(axes[0], -axes[1]))
                };
                newEv.force *= 2;
                if(newEv.force > 1.2)
                    newEv.force = 1.2;

                // console.log(`joypad force`, newEv.force);
                this.firing(null, newEv);
            });
            // console.log(joypad);
        });

        
        this.manager = nipplejs.create({
            mode: "static",
            position: { left: "50%", top: "75%" },
            color: "white",
            restOpacity: 1,
            threshold: 0.2
        });
        this.subscribers = [];
        // Events: start move end dir plain
        // this.manager.on("end", this.firing.bind(this));
        this.manager.on("move", (_, event): void => {
            // console.log(`force: ${event.force}`);
            // console.log(`${event.vector.x} ${event.vector.y}`);
            this.firing(_, event);
        });
        // console.log("Joystick manager", this.manager);
        this.manager.on("end", (_, event): void => {
            // console.log(`firing on end`, event);
            this.fireStop();
        });
        this.manager.on("shown", (): void => console.log(`firing on shown`));
        // console.log(this.manager);
    }

    private fireStop(): void {
        for (let index = 0; index < this.subscribers.length; index++) {
            this.subscribers[index]();
        }
    }

    // private firing(_: nipplejs.EventData, event: nipplejs.JoystickOutputData): void {
    private firing(_: any, event: any): void {
        // console.log(`firing `, event);
        // console.log(`firing `, event.force);
        if (event.force < 0.5) return;
        const force: number = event.force > 2.5 ? 2.5 : event.force < 0.5 ? 0.5 : event.force;
        // console.log('event vector', event);

        const eventVector: ControlVector = {
            x: +event.vector.x.toFixed(6),
            y: +event.vector.y.toFixed(6),
            force: +force.toFixed(6),
        };

        // requestAnimationFrame((): void => {
        for (let index = 0; index < this.subscribers.length; index++) {
            // console.log(`fire ${this.subscribers[index].name}`);
            this.subscribers[index](eventVector);
        }
        // });
    }

    public subscribe(callback: Function): void {
        this.subscribers.push(callback);
    }
}
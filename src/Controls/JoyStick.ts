import nipplejs from "nipplejs";
import { Controller } from "./IController";
import { ControlVector } from "../ObjectTypes/ControlVector";

export class JoyStick implements Controller {

    private manager: nipplejs.JoystickManager;
    private subscribers: Array<Function>;
    // private forceSensivity: 
    constructor() {
        this.manager = nipplejs.create({
            mode: "static",
            position: { left: "50%", top: "75%" },
            color: "white",
            restOpacity: 1,

        });
        this.subscribers = [];
        // Events: start move end dir plain
        // this.manager.on("end", this.firing.bind(this));
        this.manager.on("move", (_, event): void => console.log(`firing on move`, event));
        this.manager.on("end", (_, event): void => console.log(`firing on end`, event));
        // this.manager.on("plain", (): void => console.log(`firing on plain`));
        console.log(this.manager);
    }

    private firing(_: nipplejs.EventData, event: nipplejs.JoystickOutputData): void {
        console.log(`firing `, event);
        if (event.force < 0.5) return;
        const force: number = event.force > 2.5 ? 2.5 : event.force < 0.5 ? 0.5 : event.force;

        const eventVector: ControlVector = {
            x: +event.vector.x.toFixed(6),
            y: +event.vector.y.toFixed(6),
            force: +force.toFixed(6),
        };

        // requestAnimationFrame((): void => {
            for (let index: number = 0; index < this.subscribers.length; index++) {
                // console.log(`fire ${this.subscribers[index].name}`);
                this.subscribers[index](eventVector);
            }
        // });
    }

    public subscribe(callback: Function): void {
        this.subscribers.push(callback);
    }
}
// temp1.on('move', function (e, data) { 
//     console.log('e', e);
//     console.log('data', data);
// })
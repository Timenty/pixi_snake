import { Controller } from "./IController";
import { ControlVector } from "../ObjectTypes/ControlVector";

// Клавиатурное управление: WASD/стрелки — направление, Shift — ускорение.
// Вектор пересчитывается на каждом keydown/keyup из суммы зажатых клавиш.
// Отпущены все клавиши направления — force 0 (змейка останавливается).
export class Keyboard implements Controller {
    private subscribers: Array<Function> = [];
    private pressed: Set<string> = new Set();
    private boost = false;

    // y > 0 = вверх по экрану (совпадает с осью джойстика/геймпада)
    private static readonly DIRS: { [code: string]: [number, number] } = {
        ArrowUp: [0, 1],
        KeyW: [0, 1],
        ArrowDown: [0, -1],
        KeyS: [0, -1],
        ArrowLeft: [-1, 0],
        KeyA: [-1, 0],
        ArrowRight: [1, 0],
        KeyD: [1, 0],
    };

    constructor() {
        window.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Shift") {
                if (!this.boost) {
                    this.boost = true;
                    this.emit();
                }
                return;
            }
            if (!(e.code in Keyboard.DIRS)) return;
            e.preventDefault();
            if (e.repeat) return;
            this.pressed.add(e.code);
            this.emit();
        });

        window.addEventListener("keyup", (e: KeyboardEvent) => {
            if (e.key === "Shift") {
                this.boost = false;
                this.emit();
                return;
            }
            if (!(e.code in Keyboard.DIRS)) return;
            this.pressed.delete(e.code);
            this.emit();
        });

        // Потеря фокуса окна — keyup может не прийти, сбрасываем всё.
        window.addEventListener("blur", () => {
            if (this.pressed.size === 0 && !this.boost) return;
            this.pressed.clear();
            this.boost = false;
            this.emit();
        });
    }

    private emit(): void {
        let x = 0;
        let y = 0;
        this.pressed.forEach(code => {
            const d = Keyboard.DIRS[code];
            x += d[0];
            y += d[1];
        });

        const len = Math.hypot(x, y);
        const vector: ControlVector =
            len === 0
                ? { x: 0, y: 0, force: 0 }
                : { x: x / len, y: y / len, force: this.boost ? 1.8 : 1 };

        for (let i = 0; i < this.subscribers.length; i++) {
            this.subscribers[i](vector);
        }
    }

    public subscribe(callback: Function): void {
        this.subscribers.push(callback);
    }
}

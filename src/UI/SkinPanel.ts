import { SkinOptions, SkinPattern } from "../GameObjects/SnakeSkin";

// DOM-панель настройки кожи змейки: кнопка 🎨 справа сверху открывает форму.
// Любое изменение сразу уходит в onChange (живой предпросмотр на змейке).
export class SkinPanel {
    private opts: SkinOptions;

    constructor(initial: SkinOptions, private onChange: (opts: SkinOptions) => void) {
        this.opts = { ...initial };
        this.build();
    }

    private build(): void {
        const style = document.createElement("style");
        style.textContent = `
            .skin-toggle {
                position: fixed; top: 16px; right: 16px; z-index: 20;
                width: 48px; height: 48px; border-radius: 12px; border: none;
                background: rgba(0,0,0,0.55); font-size: 24px; cursor: pointer;
                transition: transform 0.15s;
            }
            .skin-toggle:hover { transform: scale(1.1); }
            .skin-panel {
                position: fixed; top: 76px; right: 16px; z-index: 20;
                width: 240px; padding: 16px; border-radius: 12px;
                background: rgba(10, 20, 15, 0.85); color: #fff;
                font-family: Arial, sans-serif; font-size: 14px;
                display: none; flex-direction: column; gap: 12px;
            }
            .skin-panel.open { display: flex; }
            .skin-panel label { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
            .skin-panel input[type="color"] {
                width: 48px; height: 28px; border: none; border-radius: 6px;
                background: none; cursor: pointer; padding: 0;
            }
            .skin-panel select, .skin-panel input[type="range"] { flex: 1; max-width: 130px; }
            .skin-panel select {
                background: #223; color: #fff; border: 1px solid #445;
                border-radius: 6px; padding: 4px;
            }
            .skin-panel button {
                padding: 8px; border: none; border-radius: 8px; cursor: pointer;
                background: #3a7d5d; color: #fff; font-size: 14px;
            }
            .skin-panel button:hover { background: #47996f; }
        `;
        document.head.appendChild(style);

        const toggle = document.createElement("button");
        toggle.className = "skin-toggle";
        toggle.textContent = "🎨";
        toggle.title = "Настроить змейку";
        document.body.appendChild(toggle);

        const panel = document.createElement("div");
        panel.className = "skin-panel";
        panel.innerHTML = `
            <label>Цвет тела <input type="color" data-k="bodyColor"></label>
            <label>Цвет узора <input type="color" data-k="patternColor"></label>
            <label>Узор
                <select data-k="pattern">
                    <option value="spots">Пятна</option>
                    <option value="stripes">Полосы</option>
                    <option value="zigzag">Зигзаг</option>
                    <option value="diamonds">Ромбы</option>
                    <option value="hearts">Сердечки</option>
                    <option value="none">Без узора</option>
                </select>
            </label>
            <label>Плотность <input type="range" min="1" max="10" step="1" data-k="density"></label>
            <button data-k="random">🎲 Случайная змейка</button>
        `;
        document.body.appendChild(panel);

        // Не даём клавишам панели (стрелки на слайдере и т.п.) рулить змейкой.
        panel.addEventListener("keydown", e => e.stopPropagation());
        panel.addEventListener("keyup", e => e.stopPropagation());

        toggle.addEventListener("click", () => panel.classList.toggle("open"));

        const bodyColor = panel.querySelector<HTMLInputElement>('[data-k="bodyColor"]')!;
        const patternColor = panel.querySelector<HTMLInputElement>('[data-k="patternColor"]')!;
        const pattern = panel.querySelector<HTMLSelectElement>('[data-k="pattern"]')!;
        const density = panel.querySelector<HTMLInputElement>('[data-k="density"]')!;
        const random = panel.querySelector<HTMLButtonElement>('[data-k="random"]')!;

        const sync = (): void => {
            bodyColor.value = this.opts.bodyColor;
            patternColor.value = this.opts.patternColor;
            pattern.value = this.opts.pattern;
            density.value = String(this.opts.density);
        };
        sync();

        const fire = (): void => this.onChange({ ...this.opts });

        bodyColor.addEventListener("input", () => {
            this.opts.bodyColor = bodyColor.value;
            fire();
        });
        patternColor.addEventListener("input", () => {
            this.opts.patternColor = patternColor.value;
            fire();
        });
        pattern.addEventListener("change", () => {
            this.opts.pattern = pattern.value as SkinPattern;
            fire();
        });
        density.addEventListener("input", () => {
            this.opts.density = Number(density.value);
            fire();
        });
        random.addEventListener("click", () => {
            // Пара цветов: случайный тон тела + узор со сдвигом тона на 90–180°.
            const h = Math.floor(Math.random() * 360);
            const h2 = (h + 90 + Math.floor(Math.random() * 90)) % 360;
            this.opts.bodyColor = hslToHex(h, 75, 55);
            this.opts.patternColor = hslToHex(h2, 85, 60);
            const patterns: SkinPattern[] = ["spots", "stripes", "zigzag", "diamonds", "hearts"];
            this.opts.pattern = patterns[Math.floor(Math.random() * patterns.length)];
            this.opts.density = 2 + Math.floor(Math.random() * 8);
            this.opts.seed = Math.floor(Math.random() * 1e9);
            sync();
            fire();
        });
    }
}

function hslToHex(h: number, s: number, l: number): string {
    const a = (s * Math.min(l, 100 - l)) / 100;
    const f = (n: number): string => {
        const k = (n + h / 30) % 12;
        const color = l / 100 - (a / 100) * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color)
            .toString(16)
            .padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

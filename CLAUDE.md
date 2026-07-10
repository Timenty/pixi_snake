# pixi_snake

Змейка на PixiJS v8 + TypeScript + Vite. Мир из двух биомов (песок слева до x=4500, трава справа), погодная система, кастомные шейдеры.

## Команды

- `npm run dev` — vite dev-сервер на http://localhost:1234
- `npm run build` — тайпчек + прод-сборка в dist/
- `npm run type-check` — только tsc (проходит чисто, ошибок быть не должно)
- `npm run textures` — пересобрать тайлы земли из 4K-исходников (см. ниже)

## Работа с картинками/текстурами

В devDependencies стоит **sharp** — им делается вся обработка изображений
(ресайз, конвертация, запекание AO, композиты). Не использовать PowerShell
System.Drawing (ломает бесшовность краёв тайлов и кодировки).

`scripts/prepare-ground-textures.js` — пайплайн текстур земли:
4K-исходники (`src/assets/background/Stylized_*`) → 1024 JPG с бесшовным
ресайзом (extend repeat по краям перед resize) и запечённым AO.
После смены исходников: `npm run textures`.

Тайлы земли обязаны быть power-of-two (REPEAT-сэмплинг в untiling-шейдере)
и бесшовными; JPEG q85-90.

## PixiJS v8 — грабли проекта

- Официальные skills в `.claude/skills/pixijs-*` — сверяться при работе с API.
- Blend-режимы вне батчевого набора (normal/add/multiply/screen) **молча не
  работают** при прямом `renderer.render({container, target})` в RenderTexture —
  карта влажности (WetGround) поэтому построена на multiply/add.
- Свежая RenderTexture не гарантированно чистая — заливать явно.
- Кастомные меш-шейдеры: атрибуты `aPosition`/`aUV`, матрицы
  `uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix`, uniforms в
  `UniformGroup` с типами, текстуры — resources (`texture.source`).

## Дебаг

- `window.__game` — weather, clouds, rain, wetGround, trees, snake, viewport.
- `?weather=sunny|overcast|sunshower` — стартовая погода; V — цикл в игре.
- C — коллайдер змейки.

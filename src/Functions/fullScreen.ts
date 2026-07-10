// Вендорные префиксы не описаны в стандартных типах — берём через any.
function fullScreen(element: HTMLElement) {
    const el = element as any;
    if (el.requestFullscreen) {
        el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
    } else if (el.mozRequestFullScreen) {
        el.mozRequestFullScreen();
    }
}

export { fullScreen as fullScreen };

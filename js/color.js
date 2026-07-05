// Shared temperature color scale used by the list swatches, map markers and the
// heat-map overlay so every surface reads the same cold→hot mapping.
//
// A diverging thermal ramp: cold blues, a light neutral pivot, warm reds. Stops
// are interpolated in sRGB against a data-driven [min, max] domain.

const STOPS = [
    [0.0, [42, 92, 171]],   // deep blue  – coldest
    [0.25, [86, 152, 231]], // blue
    [0.5, [235, 234, 228]], // light neutral pivot
    [0.72, [235, 104, 52]], // orange
    [1.0, [208, 59, 59]],   // red        – hottest
];

function lerp(a, b, t) {
    return Math.round(a + (b - a) * t);
}

// Map a fraction in [0, 1] to an "r,g,b" tuple along the ramp.
export function rampColor(fraction) {
    const f = Math.min(1, Math.max(0, fraction));

    for (let i = 1; i < STOPS.length; i++) {
        const [pos, rgb] = STOPS[i];

        if (f <= pos) {
            const [prevPos, prevRgb] = STOPS[i - 1];
            const local = (f - prevPos) / (pos - prevPos);
            return [
                lerp(prevRgb[0], rgb[0], local),
                lerp(prevRgb[1], rgb[1], local),
                lerp(prevRgb[2], rgb[2], local),
            ];
        }
    }

    return STOPS[STOPS.length - 1][1];
}

// CSS `linear-gradient` tracing the full ramp, for the heat-map legend.
export function rampGradientCss(direction = "to right") {
    const stops = STOPS.map(([pos, [r, g, b]]) => `rgb(${r}, ${g}, ${b}) ${Math.round(pos * 100)}%`);
    return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

// Fraction of `temp` within [min, max]; a flat domain maps everything to center.
export function tempFraction(temp, min, max) {
    if (max - min < 0.001) {
        return 0.5;
    }

    return (temp - min) / (max - min);
}

export function tempColor(temp, min, max) {
    const [r, g, b] = rampColor(tempFraction(temp, min, max));
    return `rgb(${r}, ${g}, ${b})`;
}

// Pick readable ink (dark/light) for text laid over a ramp color.
export function inkOn([r, g, b]) {
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? "#0b0b0b" : "#ffffff";
}

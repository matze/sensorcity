// Shared temperature color scale for the list swatches, map markers, history
// chart and heat map, so every surface reads one cold→hot mapping.
//
// Comfort-calibrated and absolute: color is keyed to real air temperature with
// ~21 °C (thermal comfort) at the neutral pivot, cool blues below and warm reds
// above. The domain is fixed, so a given color always means the same temperature
// — comparable across days and seasons — rather than stretched to each moment's
// spread.

const STOPS = [
    [-5, [42, 92, 171]],   // bitter cold  – deep blue
    [7, [86, 152, 231]],   // cold         – blue
    [21, [235, 234, 228]], // comfortable  – light neutral pivot
    [28, [235, 104, 52]],  // warm         – orange
    [38, [208, 59, 59]],   // heat         – red
];

export const TEMP_MIN = STOPS[0][0];
export const TEMP_MAX = STOPS[STOPS.length - 1][0];

function lerp(a, b, t) {
    return Math.round(a + (b - a) * t);
}

// Absolute air temperature (°C) → an [r, g, b] tuple along the ramp, clamped to
// the fixed domain.
export function rampColor(tempCelsius) {
    const t = Math.min(TEMP_MAX, Math.max(TEMP_MIN, tempCelsius));

    for (let i = 1; i < STOPS.length; i++) {
        const [pos, rgb] = STOPS[i];

        if (t <= pos) {
            const [prevPos, prevRgb] = STOPS[i - 1];
            const local = (t - prevPos) / (pos - prevPos);
            return [
                lerp(prevRgb[0], rgb[0], local),
                lerp(prevRgb[1], rgb[1], local),
                lerp(prevRgb[2], rgb[2], local),
            ];
        }
    }

    return STOPS[STOPS.length - 1][1];
}

// CSS `linear-gradient` tracing the ramp across the fixed domain, for the legend.
export function rampGradientCss(direction = "to right") {
    const span = TEMP_MAX - TEMP_MIN;
    const stops = STOPS.map(([temp, [r, g, b]]) =>
        `rgb(${r}, ${g}, ${b}) ${Math.round(((temp - TEMP_MIN) / span) * 100)}%`);
    return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

export function tempColor(tempCelsius) {
    const [r, g, b] = rampColor(tempCelsius);
    return `rgb(${r}, ${g}, ${b})`;
}

// Pick readable ink (dark/light) for text laid over a ramp color.
export function inkOn([r, g, b]) {
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? "#0b0b0b" : "#ffffff";
}

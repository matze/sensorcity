// Temperature color scales. Two modes share the same ramp (see color.js):
//
//   comfort  – absolute domain (-5..38 °C) with ~21 °C at the neutral pivot, so
//              a color always means the same temperature, comparable across days.
//   relative – the ramp stretched to the data's own min..max, maximizing contrast
//              at the cost of cross-moment comparability.
//
// `makeScale(mode, temps)` returns a concrete scale bound to the data it colors;
// callers pass the temperatures they render (the network for the map, one series
// for the chart), so relative mode fits each consumer's own range.

import { interpolate, FRACTIONS, rgbString, gradientCss } from "./color.js";

// Absolute anchors placing the neutral pivot at ~21 °C (thermal comfort).
const COMFORT_TEMPS = [-5, 7, 21, 28, 38];

// Bar positions (0..100 %) for those anchors. Deliberately non-linear: cold is
// rare in Karlsruhe, so the cold end is compressed to sit "behaglich" (21 °C)
// left of centre and give the everyday warm range more width. Colour per degree
// is unchanged; only the horizontal placement is skewed.
const COMFORT_POS = [0, 22, 45, 70, 100];

// Qualitative comfort reference points (°C) for labelling the history y-axis.
export const COMFORT_MARKS = [
    { temp: -5, label: "eisig" },
    { temp: 7, label: "kühl" },
    { temp: 21, label: "behaglich" },
    { temp: 28, label: "warm" },
    { temp: 38, label: "heiß" },
];
const COMFORT_MIN = COMFORT_TEMPS[0];
const COMFORT_MAX = COMFORT_TEMPS[COMFORT_TEMPS.length - 1];

// Temperature → 0..1 position along the skewed comfort bar (piecewise linear
// between the anchor/position pairs above).
function comfortFrac(temp) {
    const t = Math.min(COMFORT_MAX, Math.max(COMFORT_MIN, temp));

    for (let i = 1; i < COMFORT_TEMPS.length; i++) {
        if (t <= COMFORT_TEMPS[i]) {
            const local = (t - COMFORT_TEMPS[i - 1]) / (COMFORT_TEMPS[i] - COMFORT_TEMPS[i - 1]);
            return (COMFORT_POS[i - 1] + local * (COMFORT_POS[i] - COMFORT_POS[i - 1])) / 100;
        }
    }

    return 1;
}

export const COMFORT = "comfort";
export const RELATIVE = "relative";

const fmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

export function makeScale(mode, temps) {
    const usable = temps.filter((t) => t != null && Number.isFinite(t));

    if (mode === RELATIVE && usable.length >= 2 && Math.max(...usable) > Math.min(...usable)) {
        return relativeScale(usable);
    }

    return comfortScale();
}

function comfortScale() {
    const frac = comfortFrac;

    // Label the fixed bar with the qualitative comfort levels rather than bare
    // numbers, so a color reads as a felt temperature.
    const ticks = COMFORT_MARKS.map(({ temp, label }) => ({ label, pos: frac(temp) * 100 }));

    return {
        mode: COMFORT,
        rgb: (t) => interpolate(COMFORT_TEMPS, t),
        color: (t) => rgbString(interpolate(COMFORT_TEMPS, t)),
        gradientCss: (dir) => gradientCss(COMFORT_TEMPS.map((t) => [Math.round(frac(t) * 100), interpolate(COMFORT_TEMPS, t)]), dir),
        ticks: () => ticks,
        // Position (0..100) of a single reading within the fixed range, for the
        // marker showing where the selected station sits. Null when unusable.
        pointPos: (t) => (t != null && Number.isFinite(t) ? frac(t) * 100 : null),
    };
}

function relativeScale(temps) {
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const span = max - min;
    const frac = (t) => Math.min(1, Math.max(0, (t - min) / span));

    return {
        mode: RELATIVE,
        rgb: (t) => interpolate(FRACTIONS, frac(t)),
        color: (t) => rgbString(interpolate(FRACTIONS, frac(t))),
        gradientCss: (dir) => gradientCss(FRACTIONS.map((f) => [Math.round(f * 100), interpolate(FRACTIONS, f)]), dir),
        ticks: () => [
            { label: `${fmt.format(min)}°`, pos: 0 },
            { label: `${fmt.format((min + max) / 2)}°`, pos: 50 },
            { label: `${fmt.format(max)}°`, pos: 100 },
        ],
        pointPos: (t) => (t != null && Number.isFinite(t) ? frac(t) * 100 : null),
    };
}

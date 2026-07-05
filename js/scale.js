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
const COMFORT_MIN = COMFORT_TEMPS[0];
const COMFORT_MAX = COMFORT_TEMPS[COMFORT_TEMPS.length - 1];

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
    const span = COMFORT_MAX - COMFORT_MIN;
    const frac = (t) => (Math.min(COMFORT_MAX, Math.max(COMFORT_MIN, t)) - COMFORT_MIN) / span;

    const ticks = [];

    for (let t = Math.ceil(COMFORT_MIN / 10) * 10; t <= COMFORT_MAX; t += 10) {
        ticks.push({ label: `${t}°`, pos: frac(t) * 100 });
    }

    return {
        mode: COMFORT,
        rgb: (t) => interpolate(COMFORT_TEMPS, t),
        color: (t) => rgbString(interpolate(COMFORT_TEMPS, t)),
        gradientCss: (dir) => gradientCss(COMFORT_TEMPS.map((t) => [Math.round(frac(t) * 100), interpolate(COMFORT_TEMPS, t)]), dir),
        ticks: () => ticks,
        // The fixed bar covers the whole comfort range, so mark where the current
        // readings actually sit within it.
        nowSpan: (values) => {
            const usable = values.filter((v) => v != null && Number.isFinite(v));

            if (usable.length === 0) {
                return null;
            }

            const low = Math.min(...usable);
            const high = Math.max(...usable);
            return {
                left: frac(low) * 100,
                width: (frac(high) - frac(low)) * 100,
                label: `jetzt ${fmt.format(low)}–${fmt.format(high)} °C`,
            };
        },
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
        // The whole bar already is the current range; no extra marker needed.
        nowSpan: () => null,
    };
}

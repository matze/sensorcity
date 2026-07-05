// Low-level thermal ramp shared by every temperature scale (see scale.js): five
// RGB stops going cold blue → warm cream pivot → warm red. Higher layers pin
// these stops to either absolute degrees (comfort) or a data range (relative).

const COLORS = [
    [40, 104, 178],  // blue         – coldest
    [125, 177, 221], // light blue
    [238, 226, 193], // warm cream pivot
    [232, 138, 74],  // orange
    [201, 66, 58],   // red          – hottest
];

// Even-ish stop positions (0..1) for a data-relative diverging ramp.
export const FRACTIONS = [0, 0.25, 0.5, 0.72, 1.0];

function lerp(a, b, t) {
    return Math.round(a + (b - a) * t);
}

// Interpolate the shared COLORS against `positions` (same length) at `value`,
// clamped to the endpoints. `positions` may be fractions or absolute degrees.
export function interpolate(positions, value) {
    const v = Math.min(positions[positions.length - 1], Math.max(positions[0], value));

    for (let i = 1; i < positions.length; i++) {
        if (v <= positions[i]) {
            const local = (v - positions[i - 1]) / (positions[i] - positions[i - 1]);
            const [ar, ag, ab] = COLORS[i - 1];
            const [br, bg, bb] = COLORS[i];
            return [lerp(ar, br, local), lerp(ag, bg, local), lerp(ab, bb, local)];
        }
    }

    return COLORS[COLORS.length - 1];
}

export function rgbString([r, g, b]) {
    return `rgb(${r}, ${g}, ${b})`;
}

// CSS `linear-gradient` from `[offsetPercent, rgbTuple]` stops.
export function gradientCss(stops, direction = "to right") {
    const parts = stops.map(([pct, rgb]) => `${rgbString(rgb)} ${pct}%`);
    return `linear-gradient(${direction}, ${parts.join(", ")})`;
}

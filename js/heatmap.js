// Computed temperature heat map: inverse-distance-weighting interpolation over
// the sensor points, painted onto a canvas overlay that tracks the Leaflet map.

import { rampColor, rampGradientCss, TEMP_MIN, TEMP_MAX } from "./color.js";

// Tick temperatures for the legend: every 10 °C inside the fixed comfort domain.
function legendTicks() {
    const span = TEMP_MAX - TEMP_MIN;
    const ticks = [];

    for (let temp = Math.ceil(TEMP_MIN / 10) * 10; temp <= TEMP_MAX; temp += 10) {
        const left = ((temp - TEMP_MIN) / span) * 100;
        ticks.push(`<span style="left:${left.toFixed(1)}%">${temp}°</span>`);
    }

    return ticks.join("");
}

const CELL = 8;          // px per interpolation cell (coarse grid, upscaled)
const POWER = 2;         // IDW distance exponent
const MAX_DIST = 260;    // px beyond which a sensor stops contributing
const ALPHA = 150;       // overlay opacity (0–255)

export class HeatOverlay {
    constructor(map) {
        this.map = map;
        this.sensors = [];

        this.canvas = document.createElement("canvas");
        Object.assign(this.canvas.style, {
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none",
            zIndex: 400,
            opacity: 0.72,
        });

        this.legend = document.createElement("div");
        this.legend.className = "heat-legend";
        this.legend.innerHTML =
            `<div class="heat-legend-bar" style="background:${rampGradientCss()}"></div>` +
            `<div class="heat-legend-ticks">${legendTicks()}</div>`;

        this.enabled = false;
    }

    setData(sensors) {
        this.sensors = sensors.filter((s) => s.lat != null && s.lon != null && s.temp != null);

        if (this.enabled) {
            this.draw();
        }
    }

    enable() {
        this.enabled = true;
        this.map.getPanes().overlayPane.appendChild(this.canvas);
        this.map.getContainer().appendChild(this.legend);
        this.draw();
    }

    disable() {
        this.enabled = false;
        this.canvas.remove();
        this.legend.remove();
    }

    // Reposition + repaint after the map moves; the canvas covers the viewport.
    draw() {
        if (!this.enabled || this.sensors.length === 0) {
            return;
        }

        const size = this.map.getSize();
        const topLeft = this.map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this.canvas, topLeft);

        this.canvas.width = size.x;
        this.canvas.height = size.y;

        const points = this.sensors.map((sensor) => {
            const p = this.map.latLngToContainerPoint([sensor.lat, sensor.lon]);
            return { x: p.x, y: p.y, temp: sensor.temp };
        });

        const cols = Math.ceil(size.x / CELL);
        const rows = Math.ceil(size.y / CELL);
        const ctx = this.canvas.getContext("2d");
        const image = ctx.createImageData(cols, rows);

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const px = col * CELL;
                const py = row * CELL;
                const value = this.interpolate(px, py, points);
                const index = (row * cols + col) * 4;

                if (value == null) {
                    image.data[index + 3] = 0;
                    continue;
                }

                const [r, g, b] = rampColor(value);
                image.data[index] = r;
                image.data[index + 1] = g;
                image.data[index + 2] = b;
                image.data[index + 3] = ALPHA;
            }
        }

        this.paint(ctx, image, cols, rows, size);
    }

    interpolate(px, py, points) {
        let weightedSum = 0;
        let weightTotal = 0;
        let anyNear = false;

        for (const point of points) {
            const dist = Math.hypot(px - point.x, py - point.y);

            if (dist > MAX_DIST) {
                continue;
            }

            anyNear = true;

            if (dist < 1) {
                return point.temp;
            }

            const weight = 1 / Math.pow(dist, POWER);
            weightedSum += weight * point.temp;
            weightTotal += weight;
        }

        return anyNear ? weightedSum / weightTotal : null;
    }

    // Upscale the coarse grid onto the full-size canvas with smoothing.
    paint(ctx, image, cols, rows, size) {
        const off = document.createElement("canvas");
        off.width = cols;
        off.height = rows;
        off.getContext("2d").putImageData(image, 0, 0);

        ctx.clearRect(0, 0, size.x, size.y);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, 0, 0, cols, rows, 0, 0, size.x, size.y);
    }
}

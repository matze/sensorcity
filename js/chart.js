// Hand-rolled SVG line chart for a single measured series, with a hover
// crosshair and tooltip and an optional city-wide reference curve. No chart
// library.

import { formatFixed } from "./format.js";
import { COMFORT_MARKS } from "./scale.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 720;
const VIEW_H = 300;
const MARGIN = { top: 16, right: 20, bottom: 28, left: 40 };
const PLOT_W = VIEW_W - MARGIN.left - MARGIN.right;
const PLOT_H = VIEW_H - MARGIN.top - MARGIN.bottom;

const dayFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});

function el(name, attrs = {}) {
    const node = document.createElementNS(SVG_NS, name);

    for (const [key, value] of Object.entries(attrs)) {
        node.setAttribute(key, value);
    }

    return node;
}

// "Nice" rounded step for a target tick count over a value span.
function niceStep(span, targetTicks) {
    const raw = span / targetTicks;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const normalized = raw / magnitude;
    const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
    return step * magnitude;
}

export class Chart {
    constructor(container) {
        this.container = container;
        this.accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2a78d6";
        this.colorFor = () => this.accent;
    }

    showLoading() {
        this.container.innerHTML =
            '<div class="chart-loading"><span class="loader"><i></i><i></i><i></i></span> Lade Verlauf …</div>';
    }

    showMessage(text) {
        this.container.innerHTML = `<div class="chart-empty">${text}</div>`;
    }

    // `points` is the selected sensor's series ({ time, value }); `options` carry
    // the metric's units and formatting, an optional comfort overlay (temperature
    // only) and an optional city-wide `reference` series to compare against.
    render(points, options = {}) {
        const {
            colorFor, unit = "°C", axisUnit = "°", digits = 1,
            comfortMarks = false, reference = null,
        } = options;

        this.colorFor = colorFor || (() => this.accent);
        this.unit = unit;
        this.axisUnit = axisUnit;
        this.digits = digits;
        this.reference = reference && reference.length >= 2 ? reference : null;

        if (!points || points.length < 2) {
            this.showMessage("Keine Verlaufsdaten für diesen Zeitraum.");
            return;
        }

        this.points = points;
        const times = points.map((p) => p.time.getTime());

        this.tMin = Math.min(...times);
        this.tMax = Math.max(...times);
        const spanDays = (this.tMax - this.tMin) / 86400000;

        const values = points.map((p) => p.value)
            .concat(this.reference ? this.reference.map((p) => p.value) : []);
        let vMin = Math.min(...values);
        let vMax = Math.max(...values);
        const pad = Math.max(0.5, (vMax - vMin) * 0.1);
        vMin = Math.floor(vMin - pad);
        vMax = Math.ceil(vMax + pad);
        this.vMin = vMin;
        this.vMax = vMax;

        const svg = el("svg", { viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, role: "img" });

        this.drawYAxis(svg, vMin, vMax);
        this.drawXAxis(svg, spanDays);

        if (this.reference) {
            this.drawReference(svg, this.reference);
        }

        this.drawLine(svg, points);

        if (comfortMarks) {
            this.drawComfortMarks(svg);
        }

        this.vCrosshair = el("line", { class: "chart-crosshair", y1: MARGIN.top, y2: MARGIN.top + PLOT_H, opacity: 0 });
        this.hCrosshair = el("line", { class: "chart-crosshair", x1: MARGIN.left, x2: MARGIN.left + PLOT_W, opacity: 0 });
        this.marker = el("circle", { r: 4, stroke: "var(--surface)", "stroke-width": 2, opacity: 0 });
        svg.append(this.vCrosshair, this.hCrosshair, this.marker);

        this.container.innerHTML = "";
        this.container.append(svg);

        const dpr = window.devicePixelRatio || 1;
        const cssW = Math.round(svg.getBoundingClientRect().width * dpr) / dpr;
        const aspect = VIEW_W / VIEW_H;
        svg.style.width = `${cssW}px`;
        svg.style.height = `${cssW / aspect}px`;

        if (this.reference) {
            const legend = document.createElement("div");
            legend.className = "chart-legend";
            legend.innerHTML =
                '<span class="key key-series">Dieser Sensor</span>'
                + '<span class="key key-ref">Netzmittel</span>';
            this.container.append(legend);
        }

        this.tooltip = document.createElement("div");
        this.tooltip.className = "chart-tooltip";
        this.container.append(this.tooltip);

        this.svg = svg;
        this.bindHover();
    }

    x(time) {
        return MARGIN.left + ((time - this.tMin) / (this.tMax - this.tMin)) * PLOT_W;
    }

    y(value) {
        return MARGIN.top + (1 - (value - this.vMin) / (this.vMax - this.vMin)) * PLOT_H;
    }

    drawYAxis(svg, vMin, vMax) {
        const step = niceStep(vMax - vMin, 5);

        for (let v = Math.ceil(vMin / step) * step; v <= vMax; v += step) {
            const y = this.y(v);
            svg.append(el("line", { class: "grid-line", x1: MARGIN.left, x2: MARGIN.left + PLOT_W, y1: y, y2: y }));
            const label = el("text", { class: "axis-label", x: MARGIN.left - 8, y: y + 3, "text-anchor": "end" });
            label.textContent = `${formatFixed(v, Number.isInteger(v) ? 0 : 1)}${this.axisUnit}`;
            svg.append(label);
        }
    }

    drawXAxis(svg, spanDays) {
        const useHours = spanDays <= 2;
        const ticks = 6;
        const baseY = MARGIN.top + PLOT_H;
        svg.append(el("line", { class: "axis-line", x1: MARGIN.left, x2: MARGIN.left + PLOT_W, y1: baseY, y2: baseY }));

        for (let i = 0; i <= ticks; i++) {
            const time = this.tMin + ((this.tMax - this.tMin) * i) / ticks;
            const x = this.x(time);
            const label = el("text", { class: "axis-label", x, y: baseY + 16, "text-anchor": "middle" });
            label.textContent = (useHours ? hourFmt : dayFmt).format(new Date(time));
            svg.append(label);
        }
    }

    drawComfortMarks(svg) {
        const edge = MARGIN.left + PLOT_W;

        for (const { temp, label } of COMFORT_MARKS) {
            if (temp < this.vMin || temp > this.vMax) {
                continue;
            }

            const y = this.y(temp);
            svg.append(el("line", { class: "comfort-line", x1: MARGIN.left, x2: edge, y1: y, y2: y }));

            const node = el("text", { class: "comfort-label", x: edge - 6, y: y + 3, "text-anchor": "end" });
            node.textContent = label;
            svg.append(node);
        }
    }

    // The city-wide average as one muted, dashed line so the sensor reads as
    // above or below the network at a glance.
    drawReference(svg, points) {
        const d = points
            .map((p, i) => `${i ? "L" : "M"}${this.x(p.time.getTime()).toFixed(1)} ${this.y(p.value).toFixed(1)}`)
            .join(" ");
        svg.append(el("path", { class: "reference-line", d }));
    }

    // One short path per interval, each stroked by the interval's mean value, so
    // the line itself reads the color scale over time.
    drawLine(svg, points) {
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            const d = `M${this.x(a.time.getTime()).toFixed(1)} ${this.y(a.value).toFixed(1)}`
                + ` L${this.x(b.time.getTime()).toFixed(1)} ${this.y(b.value).toFixed(1)}`;
            svg.append(el("path", { class: "series-line", d, stroke: this.colorFor((a.value + b.value) / 2) }));
        }

        const last = points[points.length - 1];
        svg.append(el("circle", {
            cx: this.x(last.time.getTime()), cy: this.y(last.value), r: 4,
            fill: this.colorFor(last.value), stroke: "var(--surface)", "stroke-width": 2,
        }));
    }

    nearest(series, time) {
        return series.reduce((best, p) =>
            Math.abs(p.time.getTime() - time) < Math.abs(best.time.getTime() - time) ? p : best);
    }

    bindHover() {
        const fmt = (value) => formatFixed(value, this.digits);

        const move = (event) => {
            const rect = this.svg.getBoundingClientRect();
            const clientX = event.touches ? event.touches[0].clientX : event.clientX;
            const svgX = ((clientX - rect.left) / rect.width) * VIEW_W;
            const time = this.tMin + ((svgX - MARGIN.left) / PLOT_W) * (this.tMax - this.tMin);

            const point = this.nearest(this.points, time);
            const px = this.x(point.time.getTime());
            const py = this.y(point.value);
            this.vCrosshair.setAttribute("x1", px);
            this.vCrosshair.setAttribute("x2", px);
            this.vCrosshair.setAttribute("opacity", 1);
            this.hCrosshair.setAttribute("y1", py);
            this.hCrosshair.setAttribute("y2", py);
            this.hCrosshair.setAttribute("opacity", 1);
            this.marker.setAttribute("cx", px);
            this.marker.setAttribute("cy", py);
            this.marker.setAttribute("fill", this.colorFor(point.value));
            this.marker.setAttribute("opacity", 1);

            const ref = this.reference ? this.nearest(this.reference, point.time.getTime()) : null;
            this.tooltip.innerHTML =
                `<strong>${fmt(point.value)} ${this.unit}</strong>`
                + (ref ? `<br><span class="tooltip-ref">Netz ${fmt(ref.value)} ${this.unit}</span>` : "")
                + `<br>${fullFmt.format(point.time)}`;
            const box = this.container.getBoundingClientRect();
            this.tooltip.style.left = `${rect.left - box.left + (px / VIEW_W) * rect.width}px`;
            this.tooltip.style.top = `${rect.top - box.top + (py / VIEW_H) * rect.height}px`;
            this.tooltip.style.opacity = 1;
        };

        const hide = () => {
            this.vCrosshair.setAttribute("opacity", 0);
            this.hCrosshair.setAttribute("opacity", 0);
            this.marker.setAttribute("opacity", 0);
            this.tooltip.style.opacity = 0;
        };

        this.svg.addEventListener("pointermove", move);
        this.svg.addEventListener("pointerleave", hide);
    }
}

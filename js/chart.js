// Hand-rolled SVG line chart for a single temperature series, with a hover
// crosshair and tooltip. No chart library.

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 720;
const VIEW_H = 300;
const MARGIN = { top: 16, right: 18, bottom: 28, left: 40 };
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
        this.color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2a78d6";
    }

    showLoading() {
        this.container.innerHTML =
            '<div class="chart-loading"><span class="loader"><i></i><i></i><i></i></span> Lade Verlauf …</div>';
    }

    showMessage(text) {
        this.container.innerHTML = `<div class="chart-empty">${text}</div>`;
    }

    render(points, color) {
        this.color = color || this.color;

        if (!points || points.length < 2) {
            this.showMessage("Keine Verlaufsdaten für diesen Zeitraum.");
            return;
        }

        this.points = points;
        const times = points.map((p) => p.time.getTime());
        const temps = points.map((p) => p.temp);

        this.tMin = Math.min(...times);
        this.tMax = Math.max(...times);
        const spanDays = (this.tMax - this.tMin) / 86400000;

        let vMin = Math.min(...temps);
        let vMax = Math.max(...temps);
        const pad = Math.max(0.5, (vMax - vMin) * 0.1);
        vMin = Math.floor(vMin - pad);
        vMax = Math.ceil(vMax + pad);
        this.vMin = vMin;
        this.vMax = vMax;

        const svg = el("svg", { viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, role: "img" });

        this.drawYAxis(svg, vMin, vMax);
        this.drawXAxis(svg, spanDays);
        this.drawLine(svg, points);

        this.crosshair = el("line", { class: "chart-crosshair", y1: MARGIN.top, y2: MARGIN.top + PLOT_H, opacity: 0 });
        this.marker = el("circle", { r: 4, fill: this.color, stroke: "var(--surface)", "stroke-width": 2, opacity: 0 });
        svg.append(this.crosshair, this.marker);

        this.container.innerHTML = "";
        this.container.append(svg);

        this.tooltip = document.createElement("div");
        this.tooltip.className = "chart-tooltip";
        this.container.append(this.tooltip);

        this.svg = svg;
        this.bindHover();
    }

    x(time) {
        return MARGIN.left + ((time - this.tMin) / (this.tMax - this.tMin)) * PLOT_W;
    }

    y(temp) {
        return MARGIN.top + (1 - (temp - this.vMin) / (this.vMax - this.vMin)) * PLOT_H;
    }

    drawYAxis(svg, vMin, vMax) {
        const step = niceStep(vMax - vMin, 5);

        for (let v = Math.ceil(vMin / step) * step; v <= vMax; v += step) {
            const y = this.y(v);
            svg.append(el("line", { class: "grid-line", x1: MARGIN.left, x2: MARGIN.left + PLOT_W, y1: y, y2: y }));
            const label = el("text", { class: "axis-label", x: MARGIN.left - 8, y: y + 3, "text-anchor": "end" });
            label.textContent = `${v}°`;
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

    drawLine(svg, points) {
        const d = points
            .map((p, i) => `${i === 0 ? "M" : "L"}${this.x(p.time.getTime()).toFixed(1)} ${this.y(p.temp).toFixed(1)}`)
            .join(" ");
        svg.append(el("path", { class: "series-line", d, stroke: this.color }));

        const last = points[points.length - 1];
        svg.append(el("circle", {
            cx: this.x(last.time.getTime()), cy: this.y(last.temp), r: 4,
            fill: this.color, stroke: "var(--surface)", "stroke-width": 2,
        }));
    }

    bindHover() {
        const move = (event) => {
            const rect = this.svg.getBoundingClientRect();
            const clientX = event.touches ? event.touches[0].clientX : event.clientX;
            const svgX = ((clientX - rect.left) / rect.width) * VIEW_W;
            const time = this.tMin + ((svgX - MARGIN.left) / PLOT_W) * (this.tMax - this.tMin);

            const nearest = this.points.reduce((best, p) =>
                Math.abs(p.time.getTime() - time) < Math.abs(best.time.getTime() - time) ? p : best);

            const px = this.x(nearest.time.getTime());
            const py = this.y(nearest.temp);
            this.crosshair.setAttribute("x1", px);
            this.crosshair.setAttribute("x2", px);
            this.crosshair.setAttribute("opacity", 1);
            this.marker.setAttribute("cx", px);
            this.marker.setAttribute("cy", py);
            this.marker.setAttribute("opacity", 1);

            this.tooltip.innerHTML =
                `<strong>${nearest.temp.toFixed(1)} °C</strong><br>${fullFmt.format(nearest.time)}`;
            const box = this.container.getBoundingClientRect();
            this.tooltip.style.left = `${rect.left - box.left + (px / VIEW_W) * rect.width}px`;
            this.tooltip.style.top = `${rect.top - box.top + (py / VIEW_H) * rect.height}px`;
            this.tooltip.style.opacity = 1;
        };

        const hide = () => {
            this.crosshair.setAttribute("opacity", 0);
            this.marker.setAttribute("opacity", 0);
            this.tooltip.style.opacity = 0;
        };

        this.svg.addEventListener("pointermove", move);
        this.svg.addEventListener("pointerleave", hide);
    }
}

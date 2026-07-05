// Orchestrates data loading, the sensor list, detail panel, map, heat map and
// history chart, and keeps the selection in sync with the URL.

import { fetchSensors, fetchHistory, STALE_AFTER_MS } from "./api.js";
import { makeScale, COMFORT } from "./scale.js";
import { selectedKeyFromUrl, writeSelectedToUrl, onUrlChange } from "./state.js";
import { SensorMap } from "./map.js";
import { HeatOverlay } from "./heatmap.js";
import { Chart } from "./chart.js";

const REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_STATION = "Ettlinger Strasse - Kreuzung Kriegsstrasse";

const dom = {
    list: document.getElementById("sensorList"),
    search: document.getElementById("sensorSearch"),
    detail: document.getElementById("detail"),
    heatmapToggle: document.getElementById("heatmapToggle"),
    rangeControls: document.getElementById("rangeControls"),
    scaleMode: document.getElementById("scaleMode"),
    legend: document.getElementById("scaleLegend"),
};

const state = {
    sensors: [],
    byKey: new Map(),
    selectedKey: null,
    rangeDays: 7,
    scaleMode: COMFORT,
    historyPoints: null,
};

const chart = new Chart(document.getElementById("chart"));
let sensorMap;
let heatOverlay;

// The scale over the whole network, driving list swatches, map markers, the heat
// map and the legend. The chart builds its own scale over one series.
let networkScale = makeScale(COMFORT, []);

const numberFmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

function isStale(sensor) {
    return Date.now() - sensor.measuredAt > STALE_AFTER_MS;
}

function minutesAgo(sensor) {
    return Math.round((Date.now() - sensor.measuredAt) / 60000);
}

// ---------- Sensor list ----------

function renderList(filter = "") {
    const needle = filter.trim().toLowerCase();
    const matches = state.sensors.filter((sensor) => sensor.key.toLowerCase().includes(needle));

    dom.list.innerHTML = "";

    if (matches.length === 0) {
        dom.list.innerHTML = '<li class="list-empty">Keine Treffer.</li>';
        return;
    }

    for (const sensor of matches) {
        const item = document.createElement("li");
        item.className = "sensor-item";
        item.dataset.key = sensor.key;

        if (sensor.key === state.selectedKey) {
            item.classList.add("active");
        }

        if (isStale(sensor)) {
            item.classList.add("stale");
        }

        const color = networkScale.color(sensor.temp);
        item.innerHTML = `
            <span class="sensor-swatch" style="background:${color}"></span>
            <span class="sensor-name" title="${sensor.name}">${sensor.key}</span>
            <span class="sensor-temp">${sensor.temp.toFixed(1)}°</span>`;

        item.addEventListener("click", () => select(sensor.key, { fromList: true }));
        dom.list.append(item);
    }
}

function updateListSelection() {
    for (const item of dom.list.querySelectorAll(".sensor-item")) {
        item.classList.toggle("active", item.dataset.key === state.selectedKey);
    }

    const active = dom.list.querySelector(".sensor-item.active");

    if (active) {
        // Scroll only the list container, never the window — otherwise selecting
        // on load drags the viewport down to the list (bottom of the page on mobile).
        const list = dom.list;
        const delta = active.getBoundingClientRect().top - list.getBoundingClientRect().top;
        list.scrollTop += delta - (list.clientHeight - active.clientHeight) / 2;
    }
}

// ---------- Detail panel ----------

function renderDetail(sensor) {
    const stale = isStale(sensor);
    const color = networkScale.color(sensor.temp);

    dom.detail.classList.toggle("stale", stale);
    dom.detail.innerHTML = `
        <div class="detail-head">
            <h2>${sensor.name}</h2>
            <span class="detail-meta">
                ${stale ? '<span class="stale-badge">veraltet · </span>' : ""}gemessen vor ${minutesAgo(sensor)} min
            </span>
        </div>
        <div class="detail-body">
            <div class="hero">
                <span class="hero-dot" style="background:${color}"></span>
                <span class="hero-value">${sensor.temp.toFixed(1)}</span>
                <span class="hero-unit">°C</span>
            </div>
            <div class="metric-grid">
                ${metric("Luftfeuchtigkeit", sensor.humidity, "%")}
                ${metric("Luftdruck", sensor.pressure, "hPa", 0)}
                ${metric("Sonneneinstrahlung", sensor.radiation, "W/m²", 0)}
            </div>
        </div>`;
}

function metric(label, value, unit, digits = 1) {
    const shown = value == null
        ? "—"
        : new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits }).format(value);

    return `
        <div class="metric">
            <div class="metric-label">${label}</div>
            <div class="metric-value">${shown}<span class="unit">${unit}</span></div>
        </div>`;
}

// ---------- Selection ----------

async function select(key, { fromUrl = false } = {}) {
    const sensor = state.byKey.get(key);

    if (!sensor) {
        return;
    }

    state.selectedKey = key;

    if (!fromUrl) {
        writeSelectedToUrl(key);
    } else {
        document.title = `Karlsruhe SensorCity · ${key}`;
    }

    renderDetail(sensor);
    updateListSelection();
    sensorMap.highlight(key);
    await loadHistory(sensor);
}

async function loadHistory(sensor) {
    chart.showLoading();
    state.historyPoints = null;

    try {
        const points = await fetchHistory(sensor.deviceId, state.rangeDays);

        if (state.selectedKey !== sensor.key) {
            return; // selection changed while loading
        }

        state.historyPoints = points;
        renderChart();
    } catch (error) {
        chart.showMessage(`Verlauf nicht verfügbar (${error.message}).`);
    }
}

// Color the history line by the active mode, over the series' own range in
// relative mode so a single day still shows contrast.
function renderChart() {
    if (!state.historyPoints) {
        return;
    }

    const scale = makeScale(state.scaleMode, state.historyPoints.map((point) => point.temp));
    chart.render(state.historyPoints, scale.color);
}

// ---------- Data loading ----------

async function loadSensors() {
    const sensors = await fetchSensors();

    state.sensors = sensors;
    state.byKey = new Map(sensors.map((sensor) => [sensor.key, sensor]));

    networkScale = makeScale(state.scaleMode, sensors.map((sensor) => sensor.temp));

    renderList(dom.search.value);
    sensorMap.setSensors(sensors, networkScale);
    heatOverlay.setData(sensors, networkScale);
    renderLegend();
}

// The always-visible scale below the map: gradient, ticks, and (comfort mode)
// a bracket showing where the current readings fall within the fixed range.
function renderLegend() {
    const ticks = networkScale.ticks()
        .map((tick) => {
            const shift = tick.pos <= 0 ? "0" : tick.pos >= 100 ? "-100%" : "-50%";
            return `<span style="left:${tick.pos.toFixed(1)}%;transform:translateX(${shift})">${tick.label}</span>`;
        })
        .join("");
    const now = networkScale.nowSpan(state.sensors.map((sensor) => sensor.temp));
    const marker = now
        ? `<div class="scale-legend-now" style="left:${now.left.toFixed(1)}%;width:${now.width.toFixed(1)}%"></div>`
        : "";
    const caption = now ? now.label : "";

    dom.legend.innerHTML =
        `<div class="scale-legend-bar" style="background:${networkScale.gradientCss()}">${marker}</div>`
        + `<div class="scale-legend-ticks">${ticks}</div>`
        + `<div class="scale-legend-caption">${caption}</div>`;
}

function setScaleMode(mode) {
    if (mode === state.scaleMode) {
        return;
    }

    state.scaleMode = mode;
    dom.scaleMode.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));

    networkScale = makeScale(mode, state.sensors.map((sensor) => sensor.temp));
    renderList(dom.search.value);

    const selected = state.byKey.get(state.selectedKey);

    if (selected) {
        renderDetail(selected);
    }

    sensorMap.applyScale(networkScale);
    heatOverlay.applyScale(networkScale);
    renderLegend();
    renderChart();
}

async function refresh({ initial = false } = {}) {
    try {
        await loadSensors();

        const fallback = state.byKey.has(DEFAULT_STATION) ? DEFAULT_STATION : state.sensors[0]?.key;
        const wanted = initial ? (selectedKeyFromUrl() || fallback) : state.selectedKey;

        if (wanted && state.byKey.has(wanted)) {
            if (initial) {
                await select(wanted, { fromUrl: true });
            } else {
                const sensor = state.byKey.get(wanted);
                renderDetail(sensor);
                updateListSelection();
                sensorMap.highlight(wanted);
            }
        }
    } catch (error) {
        console.error("refresh failed", error);

        if (initial) {
            dom.detail.innerHTML = `<p class="error">Daten konnten nicht geladen werden: ${error.message}</p>`;
            dom.list.innerHTML = `<li class="list-empty">Fehler beim Laden.</li>`;
        }
    } finally {
        state.lastRefresh = Date.now();
    }
}

// ---------- Wiring ----------

function init() {
    sensorMap = new SensorMap("map", (key) => select(key));
    heatOverlay = new HeatOverlay(sensorMap.instance, networkScale);
    sensorMap.onViewChange(() => heatOverlay.draw());

    renderLegend();

    dom.search.addEventListener("input", () => renderList(dom.search.value));

    dom.scaleMode.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-mode]");

        if (button) {
            setScaleMode(button.dataset.mode);
        }
    });

    dom.heatmapToggle.addEventListener("change", () => {
        dom.heatmapToggle.checked ? heatOverlay.enable() : heatOverlay.disable();
    });

    // Browsers restore the checkbox state across reloads without firing `change`,
    // so honor a restored "checked" by enabling the overlay explicitly.
    if (dom.heatmapToggle.checked) {
        heatOverlay.enable();
    }

    dom.rangeControls.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-days]");

        if (!button) {
            return;
        }

        state.rangeDays = Number(button.dataset.days);
        dom.rangeControls.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === button));

        const sensor = state.byKey.get(state.selectedKey);

        if (sensor) {
            loadHistory(sensor);
        }
    });

    onUrlChange((key) => key && select(key, { fromUrl: true }));

    window.addEventListener("focus", () => {
        if (Date.now() - (state.lastRefresh || 0) > REFRESH_MS) {
            refresh();
        }
    });

    setInterval(() => refresh(), REFRESH_MS);

    refresh({ initial: true });
}

init();

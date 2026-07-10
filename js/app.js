// Orchestrates data loading, the sensor list, detail panel, map, heat map and
// history chart, and keeps the selection in sync with the URL.

import { fetchSensors, fetchHistory, STALE_AFTER_MS } from "./api.js";
import { makeScale, COMFORT, RELATIVE } from "./scale.js";
import { selectedKeyFromUrl, writeSelectedToUrl, onUrlChange, readParam, writeParam } from "./state.js";
import { SensorMap } from "./map.js";
import { HeatOverlay } from "./heatmap.js";
import { Chart } from "./chart.js";

const REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_STATION = "Ettlinger Strasse - Kreuzung Kriegsstrasse";

// The chartable measures. `field` maps to api.js; `comfort` marks temperature as
// the only one carrying the comfort color scale and reference lines.
const METRICS = {
    temp: { field: "temp", label: "Temperatur", unit: "°C", axisUnit: "°", digits: 1, comfort: true },
    humidity: { field: "humidity", label: "Luftfeuchte", unit: "%", axisUnit: "%", digits: 0, comfort: false },
    pressure: { field: "pressure", label: "Luftdruck", unit: "hPa", axisUnit: "", digits: 0, comfort: false },
    radiation: { field: "radiation", label: "Sonne", unit: "W/m²", axisUnit: "", digits: 0, comfort: false },
};

const SORTS = {
    name: (a, b) => a.key.localeCompare(b.key, "de"),
    warm: (a, b) => b.temp - a.temp,
    cold: (a, b) => a.temp - b.temp,
};

const dom = {
    list: document.getElementById("sensorList"),
    search: document.getElementById("sensorSearch"),
    sortControls: document.getElementById("sortControls"),
    detail: document.getElementById("detail"),
    heatControl: document.getElementById("heatControl"),
    rangeControls: document.getElementById("rangeControls"),
    metricControls: document.getElementById("metricControls"),
    legend: document.getElementById("scaleLegend"),
};

const state = {
    sensors: [],
    byKey: new Map(),
    selectedKey: null,
    rangeDays: 7,
    metric: "temp",
    sort: "name",
    // The one control has three positions: "off" (no overlay, comfort colors),
    // "comfort" and "relative" (overlay on, that scale everywhere).
    heatMode: "off",
    scaleMode: COMFORT,
    historyPoints: null,
    reference: null,
    trend: null,
    // City-wide reference curves, keyed by `${field}:${days}`; shared by every
    // sensor so switching selection never refetches the network average.
    referenceCache: new Map(),
};

const chart = new Chart(document.getElementById("chart"));
let sensorMap;
let heatOverlay;

// The scale over the whole network, driving list swatches, map markers, the heat
// map and the legend. The chart builds its own scale over one series.
let networkScale = makeScale(COMFORT, []);

function isStale(sensor) {
    return Date.now() - sensor.measuredAt > STALE_AFTER_MS;
}

function minutesAgo(sensor) {
    return Math.round((Date.now() - sensor.measuredAt) / 60000);
}

function resolveKey(raw) {
    if (!raw) {
        return null;
    }

    if (state.byKey.has(raw)) {
        return raw;
    }

    const sensor = state.sensors.find((s) => s.key === raw);

    return sensor ? sensor.deviceId : null;
}

// ---------- Sensor list ----------

function renderList(filter = "") {
    const needle = filter.trim().toLowerCase();
    const matches = state.sensors
        .filter((sensor) => sensor.key.toLowerCase().includes(needle))
        .sort(SORTS[state.sort]);

    dom.list.innerHTML = "";

    if (matches.length === 0) {
        dom.list.innerHTML = '<li class="list-empty">Keine Treffer.</li>';
        return;
    }

    for (const sensor of matches) {
        const item = document.createElement("li");
        item.className = "sensor-item";
        item.dataset.key = sensor.deviceId;

        if (sensor.deviceId === state.selectedKey) {
            item.classList.add("active");
        }

        if (isStale(sensor)) {
            item.classList.add("stale");
        }

        const color = networkScale.color(sensor.temp);
        item.innerHTML = `
            <span class="sensor-swatch" style="background:${color}"></span>
            <span class="sensor-name" title="${sensor.name}">${sensor.name}</span>
            <span class="sensor-temp">${sensor.temp.toFixed(1)}°</span>`;

        item.addEventListener("click", () => select(sensor.deviceId, { fromList: true }));
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
            <div class="hero-block">
                <div class="hero">
                    <span class="hero-dot" style="background:${color}"></span>
                    <span class="hero-value">${sensor.temp.toFixed(1)}</span>
                    <span class="hero-unit">°C</span>
                    ${trendBadge(state.trend)}
                </div>
                ${heroCaption(sensor)}
            </div>
            <div class="metric-grid">
                ${metric("Luftfeuchtigkeit", sensor.humidity, "%")}
                ${metric("Luftdruck", sensor.pressure, "hPa", 0)}
                ${metric("Sonneneinstrahlung", sensor.radiation, "W/m²", 0)}
            </div>
        </div>`;
}

// Arrow and signed delta against the reading of ~24 h ago; nothing when the
// history for it hasn't loaded or the change is negligible.
function trendBadge(trend) {
    if (trend == null || Math.abs(trend) < 0.1) {
        return "";
    }

    const rising = trend > 0;

    return `<span class="hero-trend ${rising ? "up" : "down"}" title="gegenüber gestern">`
        + `${rising ? "▲" : "▼"} ${Math.abs(trend).toFixed(1)}°</span>`;
}

// Only the apparent temperature, and only when heat and humidity pull it away
// from the reading — the color scale already conveys plain comfort.
function heroCaption(sensor) {
    const feels = apparentTemp(sensor.temp, sensor.humidity);

    if (feels == null || Math.abs(feels - sensor.temp) < 1) {
        return "";
    }

    return `<div class="hero-caption">gefühlt ${feels.toFixed(0)} °C</div>`;
}

// Heat-index apparent temperature (Rothfusz), valid in warm, humid air; null
// outside that range where the formula does not apply.
function apparentTemp(temp, humidity) {
    if (temp == null || humidity == null || temp < 27) {
        return null;
    }

    const f = temp * 9 / 5 + 32;
    const hi = -42.379 + 2.04901523 * f + 10.14333127 * humidity
        - 0.22475541 * f * humidity - 0.00683783 * f * f
        - 0.05481717 * humidity * humidity + 0.00122874 * f * f * humidity
        + 0.00085282 * f * humidity * humidity - 0.00000199 * f * f * humidity * humidity;

    return (hi - 32) * 5 / 9;
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
    state.trend = null;
    document.title = `Karlsruhe SensorCity · ${sensor.name}`;

    if (!fromUrl) {
        writeSelectedToUrl(key);
    }

    renderDetail(sensor);
    updateListSelection();
    renderLegend();
    sensorMap.highlight(key);
    await Promise.all([loadHistory(sensor), loadTrend(sensor)]);
}

async function loadHistory(sensor) {
    chart.showLoading();
    state.historyPoints = null;
    state.reference = null;

    const { field } = METRICS[state.metric];

    try {
        const [points, reference] = await Promise.all([
            fetchHistory({ deviceId: sensor.deviceId, days: state.rangeDays, field }),
            loadReference(field, state.rangeDays),
        ]);

        if (state.selectedKey !== sensor.deviceId || state.metric !== metricKeyFor(field)) {
            return; // selection or metric changed while loading
        }

        state.historyPoints = points;
        state.reference = reference;
        renderChart();
    } catch (error) {
        chart.showMessage(`Verlauf nicht verfügbar (${error.message}).`);
    }
}

// The city-wide average for the active metric and range, fetched once and then
// served from the cache; a failure just drops the reference line.
async function loadReference(field, days) {
    const cacheKey = `${field}:${days}`;

    if (state.referenceCache.has(cacheKey)) {
        return state.referenceCache.get(cacheKey);
    }

    try {
        const points = await fetchHistory({ days, field });
        state.referenceCache.set(cacheKey, points);
        return points;
    } catch {
        return null;
    }
}

function metricKeyFor(field) {
    return Object.keys(METRICS).find((key) => METRICS[key].field === field);
}

// The temperature change against the reading from the same time the day before,
// shown next to the hero value. Skipped when no reading falls near that hour.
const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_TOLERANCE_MS = 3 * 60 * 60 * 1000;

async function loadTrend(sensor) {
    try {
        const points = await fetchHistory({ deviceId: sensor.deviceId, days: 2, field: "temp" });

        if (state.selectedKey !== sensor.deviceId || points.length === 0) {
            return;
        }

        const target = sensor.measuredAt - DAY_MS;
        const past = points.reduce((best, point) =>
            Math.abs(point.time - target) < Math.abs(best.time - target) ? point : best);

        if (Math.abs(past.time - target) > TREND_TOLERANCE_MS) {
            return;
        }

        state.trend = Math.round((sensor.temp - past.value) * 10) / 10;
        renderDetail(sensor);
    } catch {
        /* the trend badge is optional; leave it off on failure */
    }
}

// Color the history line by the active mode, over the series' own range in
// relative mode so a single day still shows contrast. Only temperature carries
// the comfort scale and reference curve; other metrics use the plain accent.
function renderChart() {
    if (!state.historyPoints) {
        return;
    }

    const metric = METRICS[state.metric];
    const colorFor = metric.comfort
        ? makeScale(state.scaleMode, state.historyPoints.map((point) => point.value)).color
        : null;

    chart.render(state.historyPoints, {
        colorFor,
        unit: metric.unit,
        axisUnit: metric.axisUnit,
        digits: metric.digits,
        comfortMarks: metric.comfort,
        reference: state.reference,
    });
}

// ---------- Data loading ----------

async function loadSensors() {
    const sensors = await fetchSensors();

    state.sensors = sensors;
    state.byKey = new Map(sensors.map((sensor) => [sensor.deviceId, sensor]));

    networkScale = makeScale(state.scaleMode, sensors.map((sensor) => sensor.temp));

    renderList(dom.search.value);
    sensorMap.setSensors(sensors, networkScale);
    heatOverlay.setData(sensors, networkScale);

    if (state.heatMode === "off") {
        heatOverlay.disable();
    } else {
        heatOverlay.applyScale(networkScale);
        heatOverlay.enable();
    }

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
    const selected = state.byKey.get(state.selectedKey);
    const pos = selected ? networkScale.pointPos(selected.temp) : null;
    // Inset the dot's center by its radius so it stays fully on the bar at the ends.
    const marker = pos != null
        ? `<div class="scale-legend-dot" style="left:calc(var(--dot) / 2 + (100% - var(--dot)) * ${(pos / 100).toFixed(4)})"></div>`
        : "";

    dom.legend.innerHTML =
        `<div class="scale-legend-bar" style="background:${networkScale.gradientCss()}">${marker}</div>`
        + `<div class="scale-legend-ticks">${ticks}</div>`;
}

// The 3-state map control: "off" hides the overlay and colors everything with
// the comfort scale; "comfort"/"relative" turn the overlay on with that scale.
function setHeatMode(mode) {
    if (mode === state.heatMode) {
        return;
    }

    state.heatMode = mode;
    writeParam("heat", mode === "off" ? null : mode);
    dom.heatControl.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));

    const scaleMode = mode === "relative" ? RELATIVE : COMFORT;

    if (scaleMode !== state.scaleMode) {
        state.scaleMode = scaleMode;
        recolorForScale();
    }

    if (mode === "off") {
        heatOverlay.disable();
    } else {
        heatOverlay.applyScale(networkScale);
        heatOverlay.enable();
    }
}

// Rebuild the network scale and repaint everything it colors.
function recolorForScale() {
    networkScale = makeScale(state.scaleMode, state.sensors.map((sensor) => sensor.temp));
    renderList(dom.search.value);

    const selected = state.byKey.get(state.selectedKey);

    if (selected) {
        renderDetail(selected);
    }

    sensorMap.applyScale(networkScale);
    renderLegend();
    renderChart();
}

async function refresh({ initial = false } = {}) {
    try {
        await loadSensors();

        const fallback = resolveKey(DEFAULT_STATION) || state.sensors[0]?.deviceId;
        let wanted;

        if (initial) {
            const fromUrl = selectedKeyFromUrl();
            wanted = fromUrl ? resolveKey(fromUrl) : null;
            if (!wanted) wanted = fallback;
        } else {
            wanted = state.selectedKey;
        }

        if (wanted && state.byKey.has(wanted)) {
            if (initial) {
                await select(wanted, { fromUrl: true });
            } else {
                const sensor = state.byKey.get(wanted);
                renderDetail(sensor);
                updateListSelection();
                renderLegend();
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

// Mark the one button in a segmented control whose `data-<attr>` equals `value`.
function markActive(container, attr, value) {
    container.querySelectorAll("button").forEach((button) =>
        button.classList.toggle("active", button.dataset[attr] === String(value)));
}

// Restore range, metric, sort and heat mode from the query so a shared link
// reopens the same view. Runs before the first load, so no refetch here.
function restoreViewFromUrl() {
    const days = Number(readParam("days"));

    if ([1, 7, 30].includes(days)) {
        state.rangeDays = days;
    }

    if (METRICS[readParam("metric")]) {
        state.metric = readParam("metric");
    }

    if (SORTS[readParam("sort")]) {
        state.sort = readParam("sort");
    }

    if (["comfort", "relative"].includes(readParam("heat"))) {
        state.heatMode = readParam("heat");
        state.scaleMode = state.heatMode === "relative" ? RELATIVE : COMFORT;
    }

    markActive(dom.rangeControls, "days", state.rangeDays);
    markActive(dom.metricControls, "metric", state.metric);
    markActive(dom.sortControls, "sort", state.sort);
    markActive(dom.heatControl, "mode", state.heatMode);
}

function init() {
    sensorMap = new SensorMap("map", (key) => select(key));
    heatOverlay = new HeatOverlay(sensorMap.instance, networkScale);
    sensorMap.onViewChange(() => heatOverlay.draw());

    restoreViewFromUrl();
    renderLegend();

    dom.search.addEventListener("input", () => renderList(dom.search.value));

    dom.sortControls.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-sort]");

        if (!button) {
            return;
        }

        state.sort = button.dataset.sort;
        writeParam("sort", state.sort === "name" ? null : state.sort);
        markActive(dom.sortControls, "sort", state.sort);
        renderList(dom.search.value);
    });

    dom.heatControl.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-mode]");

        if (button) {
            setHeatMode(button.dataset.mode);
        }
    });

    dom.metricControls.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-metric]");

        if (!button || button.dataset.metric === state.metric) {
            return;
        }

        state.metric = button.dataset.metric;
        writeParam("metric", state.metric === "temp" ? null : state.metric);
        markActive(dom.metricControls, "metric", state.metric);

        const sensor = state.byKey.get(state.selectedKey);

        if (sensor) {
            loadHistory(sensor);
        }
    });

    dom.rangeControls.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-days]");

        if (!button) {
            return;
        }

        state.rangeDays = Number(button.dataset.days);
        writeParam("days", state.rangeDays === 7 ? null : state.rangeDays);
        markActive(dom.rangeControls, "days", state.rangeDays);

        const sensor = state.byKey.get(state.selectedKey);

        if (sensor) {
            loadHistory(sensor);
        }
    });

    onUrlChange((raw) => {
        const key = raw && resolveKey(raw);
        if (key) select(key, { fromUrl: true });
    });

    window.addEventListener("focus", () => {
        if (Date.now() - (state.lastRefresh || 0) > REFRESH_MS) {
            refresh();
        }
    });

    setInterval(() => refresh(), REFRESH_MS);

    refresh({ initial: true });
}

init();

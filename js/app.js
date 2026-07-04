// Orchestrates data loading, the sensor list, detail panel, map, heat map and
// history chart, and keeps the selection in sync with the URL.

import { fetchSensors, fetchHistory, STALE_AFTER_MS } from "./api.js";
import { tempColor } from "./color.js";
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
    updateStatus: document.getElementById("updateStatus"),
    refresh: document.getElementById("refreshButton"),
    heatmapToggle: document.getElementById("heatmapToggle"),
    rangeControls: document.getElementById("rangeControls"),
};

const state = {
    sensors: [],
    byKey: new Map(),
    selectedKey: null,
    rangeDays: 7,
    tempMin: 0,
    tempMax: 1,
};

const chart = new Chart(document.getElementById("chart"));
let sensorMap;
let heatOverlay;

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

        const color = tempColor(sensor.temp, state.tempMin, state.tempMax);
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
    const color = tempColor(sensor.temp, state.tempMin, state.tempMax);

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

    try {
        const points = await fetchHistory(sensor.deviceId, state.rangeDays);

        if (state.selectedKey !== sensor.key) {
            return; // selection changed while loading
        }

        chart.render(points, tempColor(sensor.temp, state.tempMin, state.tempMax));
    } catch (error) {
        chart.showMessage(`Verlauf nicht verfügbar (${error.message}).`);
    }
}

// ---------- Data loading ----------

async function loadSensors() {
    const sensors = await fetchSensors();

    state.sensors = sensors;
    state.byKey = new Map(sensors.map((sensor) => [sensor.key, sensor]));

    // Robust color domain: clip to the 5th–95th percentile so a couple of hot or
    // cold outliers don't compress the whole cluster into one end of the ramp.
    const temps = sensors.map((sensor) => sensor.temp).sort((a, b) => a - b);
    const percentile = (p) => temps[Math.min(temps.length - 1, Math.floor(p * (temps.length - 1)))];
    state.tempMin = percentile(0.05);
    state.tempMax = percentile(0.95);

    renderList(dom.search.value);
    sensorMap.setSensors(sensors, state.tempMin, state.tempMax);
    heatOverlay.setData(sensors, state.tempMin, state.tempMax);

    const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date());
    dom.updateStatus.innerHTML = `<span class="update-word">Aktualisiert </span>${time}`;
}

async function refresh({ initial = false } = {}) {
    dom.refresh.classList.add("busy");

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

        dom.updateStatus.textContent = "Aktualisierung fehlgeschlagen";
    } finally {
        state.lastRefresh = Date.now();
        dom.refresh.classList.remove("busy");
    }
}

// ---------- Wiring ----------

function init() {
    sensorMap = new SensorMap("map", (key) => select(key));
    heatOverlay = new HeatOverlay(sensorMap.instance);
    sensorMap.onViewChange(() => heatOverlay.draw());

    dom.search.addEventListener("input", () => renderList(dom.search.value));

    dom.refresh.addEventListener("click", () => refresh());

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

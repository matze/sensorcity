// Access to Karlsruhe's public "SensorCity" ArcGIS FeatureServer.
// Layer 1 holds the latest reading per sensor; layer 2 serves hourly history.

const SERVICE = "https://geoportal.karlsruhe.de/ags04/rest/services/Hosted/Sensordaten_NodeRED/FeatureServer";
const CURRENT_URL = `${SERVICE}/1/query`;
const HISTORY_URL = `${SERVICE}/2/query`;

export const STALE_AFTER_MS = 60 * 60 * 1000;

// The FeatureServer mixes sensor kinds (see `beschreibung`): air-temperature
// weather stations, `TSK-Container` waste-bin sensors, soil, rain and water-level
// probes. Only the weather stations measure ambient air; the container sensors
// report the temperature inside a metal bin and read wildly hot, so we keep the
// weather stations alone for the list, map and heat map.
const AIR_TEMPERATURE = "Temperatur";

async function fetchJson(url, params) {
    // `no-store` skips conditional revalidation, which otherwise makes a manual
    // refresh come back as 304 Not Modified and always fetches the live reading.
    const response = await fetch(`${url}?${new URLSearchParams(params)}`, { cache: "no-store" });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

// One sensor derived from a FeatureServer/1 feature. `lon`/`lat` come from the
// feature geometry (x/y); `key` is the human-readable location used in URLs.
function toSensor(feature) {
    const a = feature.attributes;
    const geometry = feature.geometry;

    return {
        key: a.standort,
        name: a.name || a.standort,
        deviceId: a.device_id,
        temp: a.temp,
        humidity: a.luftfeuchte,
        pressure: a.press != null ? a.press / 100 : null,
        radiation: a.sonnenstrahlung,
        kind: a.beschreibung,
        category: a.temperaturkategorien,
        measuredAt: a.measured_at,
        lon: geometry ? geometry.x : null,
        lat: geometry ? geometry.y : null,
    };
}

// All sensors with their latest reading, coldest first, invalid entries dropped.
export async function fetchSensors() {
    const data = await fetchJson(CURRENT_URL, {
        where: "1=1",
        outFields: "*",
        returnGeometry: "true",
        f: "json",
        resultRecordCount: "5000",
    });

    return data.features
        .map(toSensor)
        .filter((sensor) => sensor.key && sensor.temp != null && sensor.kind === AIR_TEMPERATURE)
        .sort((a, b) => a.key.localeCompare(b.key, "de"));
}

function isoDay(date) {
    return date.toISOString().split("T")[0];
}

// Hourly average temperature for one device over the last `days` days.
// Returns points sorted by time: { time: Date, temp: number }.
export async function fetchHistory(deviceId, days) {
    const now = new Date();
    const until = new Date(now);
    until.setDate(until.getDate() + 1);
    const from = new Date(now);
    from.setDate(from.getDate() - days);

    const extract = (unit) =>
        `EXTRACT(${unit} FROM measured_at  +INTERVAL '1:59:59' HOUR TO SECOND)`;

    const data = await fetchJson(HISTORY_URL, {
        f: "json",
        cacheHint: "true",
        groupByFieldsForStatistics: ["YEAR", "MONTH", "DAY", "HOUR"].map(extract).join(","),
        outFields: "objectid,temp,measured_at",
        outStatistics: JSON.stringify([
            { onStatisticField: "temp", outStatisticFieldName: "value", statisticType: "avg" },
        ]),
        resultType: "standard",
        returnGeometry: "false",
        spatialRel: "esriSpatialRelIntersects",
        where: `((measured_at BETWEEN timestamp '${isoDay(from)} 00:00:00' AND timestamp '${isoDay(until)} 00:00:00')) AND (device_id='${deviceId}')`,
    });

    return data.features
        .map((feature) => {
            const a = feature.attributes;
            return {
                time: new Date(a.EXPR_1, a.EXPR_2 - 1, a.EXPR_3, a.EXPR_4),
                temp: Math.round(a.value * 10) / 10,
            };
        })
        .filter((point) => Number.isFinite(point.temp))
        .sort((a, b) => a.time - b.time);
}

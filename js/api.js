// Access to Karlsruhe's public "SensorCity" ArcGIS FeatureServer.
// Layer 1 holds the latest reading per sensor; layer 2 serves hourly history.

const SERVICE = "https://geoportal.karlsruhe.de/ags04/rest/services/Hosted/Sensordaten_NodeRED/FeatureServer";
const CURRENT_URL = `${SERVICE}/1/query`;
const HISTORY_URL = `${SERVICE}/2/query`;

export const STALE_AFTER_MS = 60 * 60 * 1000;

// The FeatureServer mixes sensor kinds (see `beschreibung`): air-temperature
// weather stations, soil, rain and water-level probes. Only the weather stations
// measure ambient air, so we keep them alone for the list, map and heat map.
// The label was renamed from `Temperatur` to `Temperatur-Sensor`; the archive
// still holds both, so match on the shared prefix to span the transition.
const AIR_TEMPERATURE_PREFIX = "Temperatur";

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
        .filter((sensor) => sensor.key && sensor.temp != null && sensor.kind?.startsWith(AIR_TEMPERATURE_PREFIX))
        .sort((a, b) => a.key.localeCompare(b.key, "de"));
}

function isoDay(date) {
    return date.toISOString().split("T")[0];
}

// The measured columns that can be charted over time, with the factor to bring
// them into the display unit (`press` is Pascal, shown as hectopascal).
const HISTORY_FIELDS = {
    temp: { column: "temp", factor: 1 },
    humidity: { column: "luftfeuchte", factor: 1 },
    pressure: { column: "press", factor: 1 / 100 },
    radiation: { column: "sonnenstrahlung", factor: 1 },
};

// Hourly average of one measured field over the last `days` days. With a
// `deviceId` it covers a single sensor; without one it averages across the whole
// air-temperature network, giving the city-wide reference curve. Returns points
// sorted by time: { time: Date, value: number }.
export async function fetchHistory({ deviceId = null, days, field = "temp" }) {
    const { column, factor } = HISTORY_FIELDS[field];
    const now = new Date();
    const until = new Date(now);
    until.setDate(until.getDate() + 1);
    const from = new Date(now);
    from.setDate(from.getDate() - days);

    const extract = (unit) =>
        `EXTRACT(${unit} FROM measured_at  +INTERVAL '1:59:59' HOUR TO SECOND)`;

    const scope = deviceId ? `device_id='${deviceId}'` : `beschreibung LIKE '${AIR_TEMPERATURE_PREFIX}%'`;

    const data = await fetchJson(HISTORY_URL, {
        f: "json",
        cacheHint: "true",
        groupByFieldsForStatistics: ["YEAR", "MONTH", "DAY", "HOUR"].map(extract).join(","),
        outFields: `objectid,${column},measured_at`,
        outStatistics: JSON.stringify([
            { onStatisticField: column, outStatisticFieldName: "value", statisticType: "avg" },
        ]),
        resultType: "standard",
        returnGeometry: "false",
        spatialRel: "esriSpatialRelIntersects",
        where: `((measured_at BETWEEN timestamp '${isoDay(from)} 00:00:00' AND timestamp '${isoDay(until)} 00:00:00')) AND (${scope})`,
    });

    return data.features
        .map((feature) => {
            const a = feature.attributes;
            return {
                time: new Date(a.EXPR_1, a.EXPR_2 - 1, a.EXPR_3, a.EXPR_4),
                value: Math.round(a.value * factor * 10) / 10,
            };
        })
        .filter((point) => Number.isFinite(point.value))
        .sort((a, b) => a.time - b.time);
}

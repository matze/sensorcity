// Leaflet map of all sensors. Each sensor is a divIcon dot colored by the shared
// temperature scale; clicking one selects it. Uses the global `L` from the
// vendored Leaflet script.

import { tempColor } from "./color.js";

const KARLSRUHE = [49.0069, 8.4037];
const FOCUS_ZOOM = 15;

export class SensorMap {
    constructor(containerId, onSelect) {
        this.onSelect = onSelect;
        this.markers = new Map();

        this.map = L.map(containerId, { zoomControl: true }).setView(KARLSRUHE, 12);

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "© OpenStreetMap",
        }).addTo(this.map);
    }

    // Callback fired after the map settles (for a heat-map overlay to realign).
    onViewChange(callback) {
        this.map.on("moveend zoomend", callback);
    }

    get instance() {
        return this.map;
    }

    setSensors(sensors, min, max) {
        this.markers.forEach((entry) => entry.marker.remove());
        this.markers.clear();

        const located = sensors.filter((s) => s.lat != null && s.lon != null);

        located.forEach((sensor) => {
            const marker = L.marker([sensor.lat, sensor.lon], {
                icon: this.icon(sensor, min, max, false),
                title: sensor.name,
            });

            marker.on("click", () => this.onSelect(sensor.key));
            marker.addTo(this.map);
            this.markers.set(sensor.key, { marker, sensor });
        });

        if (located.length && !this.fitted) {
            this.map.fitBounds(located.map((s) => [s.lat, s.lon]), { padding: [30, 30] });
            this.fitted = true;
        }

        this.min = min;
        this.max = max;
    }

    icon(sensor, min, max, selected) {
        const color = tempColor(sensor.temp, min, max);
        return L.divIcon({
            className: "",
            html: `<div class="marker-dot${selected ? " selected" : ""}" style="background:${color}"></div>`,
            iconSize: selected ? [22, 22] : [16, 16],
            iconAnchor: selected ? [11, 11] : [8, 8],
        });
    }

    highlight(key) {
        this.markers.forEach((entry, entryKey) => {
            entry.marker.setIcon(this.icon(entry.sensor, this.min, this.max, entryKey === key));
        });

        const active = this.markers.get(key);

        if (active) {
            const zoom = Math.max(this.map.getZoom(), FOCUS_ZOOM);
            this.map.flyTo(active.marker.getLatLng(), zoom, { duration: 0.6 });
            active.marker.bindPopup(
                `<strong>${active.sensor.name}</strong><br>${active.sensor.temp.toFixed(1)} °C`,
                { maxWidth: 220 }
            ).openPopup();
        }
    }
}

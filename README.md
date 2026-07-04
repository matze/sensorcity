# Karlsruhe SensorCity

👉 **[Open the live dashboard](https://matze.github.io/sensorcity/)** 🌡️

Fast, minimal dashboard for the City of Karlsruhe's public weather-sensor
network. Shows current temperature, humidity, pressure and solar radiation for a
chosen sensor, with a sortable list, a map, a temperature history chart and a
computed heat map.

## Data source

Karlsruhe's public ArcGIS FeatureServer
(`geoportal.karlsruhe.de/ags04/.../Sensordaten_NodeRED/FeatureServer`):
layer `1` for the latest reading per sensor, layer `2` for hourly history. See
`js/api.js`.

## Develop

Any static file server works; ES modules require `http://`, not `file://`:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Structure

| Path | Purpose |
|------|---------|
| `index.html` | Page structure |
| `css/style.css` | Styling, light/dark |
| `js/api.js` | FeatureServer queries |
| `js/state.js` | URL ⇆ selected sensor (`?station=`) |
| `js/color.js` | Shared temperature color scale |
| `js/map.js` | Leaflet map + markers |
| `js/heatmap.js` | IDW heat-map overlay |
| `js/chart.js` | SVG history chart |
| `js/app.js` | Orchestration |

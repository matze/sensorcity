// Selected sensor synced to the URL as ?station=<standort>, so any view is a
// stable, shareable link. A #hash is accepted as a fallback for older links.

const PARAM = "station";
const TITLE = "Karlsruhe SensorCity";

export function selectedKeyFromUrl() {
    const params = new URLSearchParams(location.search);

    if (params.has(PARAM)) {
        return params.get(PARAM);
    }

    if (location.hash.length > 1) {
        return decodeURIComponent(location.hash.substring(1));
    }

    return null;
}

export function writeSelectedToUrl(key) {
    const url = new URL(location.href);
    url.searchParams.set(PARAM, key);
    url.hash = "";
    history.replaceState({}, "", url);
}

// Notify when the user navigates history (back/forward) to another sensor.
export function onUrlChange(callback) {
    window.addEventListener("popstate", () => callback(selectedKeyFromUrl()));
}

// Extra view state (range, chart metric, heat mode, sort) kept in the query so a
// shared link restores the whole view, not just the sensor.
export function readParam(name) {
    return new URLSearchParams(location.search).get(name);
}

export function writeParam(name, value) {
    const url = new URL(location.href);

    if (value == null) {
        url.searchParams.delete(name);
    } else {
        url.searchParams.set(name, value);
    }

    history.replaceState({}, "", url);
}

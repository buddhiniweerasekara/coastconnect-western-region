/*
FILE PURPOSE: Loads all 17 existing GeoJSON datasets listed in config.js.
WHAT THIS FILE DOES:
  - Loops over APP_CONFIG.dataFiles (one loop instead of 17 separate
    fetch() calls - section AL).
  - Fetches each file with the browser fetch() API.
  - If a file is missing or invalid, logs a console warning and
    continues loading the rest (section AG, AH) instead of stopping
    the whole application.
  - Stores every successfully loaded FeatureCollection in a simple
    in-memory object, keyed by dataset id, for layers.js and search.js
    to use.
MAIN FUNCTIONS: DataLoader.loadAll, DataLoader.get, DataLoader.getAllLoaded
DEPENDENCIES: config.js, utils.js
--------------------------------------------------------------------------
*/

const DataLoader = (function () {
  const store = {};      // { datasetId: FeatureCollection }
  const loadReport = [];  // [{ id, name, status: "ok"|"failed", featureCount }]

  async function loadAll(onProgress) {
    const tasks = APP_CONFIG.dataFiles.map((def) => loadOneDataset(def, onProgress));
    await Promise.all(tasks);
    return { store, loadReport };
  }

  async function loadOneDataset(def, onProgress) {
    try {
      const response = await fetch(def.file, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " for " + def.file);
      }
      const json = await response.json();

      if (!json || json.type !== "FeatureCollection" || !Array.isArray(json.features)) {
        throw new Error(def.file + " is not a valid GeoJSON FeatureCollection.");
      }

      store[def.id] = json;
      loadReport.push({ id: def.id, name: def.name, status: "ok", featureCount: json.features.length });
      console.info("CoastConnect: loaded " + def.name + " (" + json.features.length + " features).");
    } catch (err) {
      // A missing file is expected until the student adds their own
      // converted GeoJSON - we do not want this to break the whole app.
      loadReport.push({ id: def.id, name: def.name, status: "failed", featureCount: 0 });
      console.warn("CoastConnect: could not load " + def.name + " (" + def.file + "). " +
        "The map will continue without this layer. Details:", err.message);
    } finally {
      if (typeof onProgress === "function") onProgress(def);
    }
  }

  function get(datasetId) {
    return store[datasetId] || null;
  }

  function getAllLoaded() {
    return store;
  }

  function getLoadReport() {
    return loadReport.slice();
  }

  return { loadAll, get, getAllLoaded, getLoadReport };
})();
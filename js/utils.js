/*
FILE PURPOSE: Small reusable helper functions shared by every other file.
WHAT THIS FILE DOES:
  - Reads attributes safely from GeoJSON features whose field names may
    differ between datasets (getFirstAvailableProperty).
  - Validates latitude/longitude values.
  - Calculates straight-line (Haversine) distance between two points.
  - Escapes text before it is placed into HTML (prevents broken/unsafe
    popups if a Google Sheet cell contains HTML-like text).
  - Compresses/resizes a user-chosen photo in the browser before it is
    sent anywhere (compressImageFile).
  - Submits JSON to the Google Apps Script backend in a CORS-safe way
    (postToAppsScript) - this project's ONLY network write path.
  - A simple text-similarity check used only for the soft "possible
    duplicate place" warning (textSimilarity).
  - AppModal: the tiny shared controller for the ONE reusable form modal
    (#appModal in index.html) that place-form.js, feedback.js and
    participation.js all open/close/fill.
MAIN FUNCTIONS:
  getFirstAvailableProperty, isValidLat, isValidLng, isValidCoordinate,
  isWithinSriLankaRoughly, haversineDistanceKm, escapeHTML, isValidImageURL,
  isValidYouTubeURL, getYouTubeEmbedURL, formatDistance, uid, debounce,
  isPlaceholderValue, compressImageFile, postToAppsScript, textSimilarity,
  AppModal.open / AppModal.close / AppModal.getBody
DEPENDENCIES: APP_CONFIG (for the Sri Lanka rough bounding box and upload
  limits). AppModal also depends on the #appModal markup in index.html.
--------------------------------------------------------------------------
*/

// --------------------------------------------------------------------
// ATTRIBUTE HANDLING
// --------------------------------------------------------------------
// properties: the GeoJSON feature's "properties" object
// candidateNames: an array of possible field names, in priority order
// fallback: value returned if none of the candidate fields have data
function getFirstAvailableProperty(properties, candidateNames, fallback) {
  if (!properties) return fallback !== undefined ? fallback : null;
  for (let i = 0; i < candidateNames.length; i++) {
    const key = candidateNames[i];
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      const value = properties[key];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        return value;
      }
    }
  }
  return fallback !== undefined ? fallback : null;
}

// Convenience wrappers built on top of APP_CONFIG.attributeFieldCandidates.
// Used only for the 6 non-editable informational datasets now (cities,
// roads, railway, transport, water, wp) - the 11 editable tourism
// categories use their own standard column names (name, desc, ...)
// directly, since those are guaranteed by the QGIS preparation step.
function getPlaceName(properties) {
  return getFirstAvailableProperty(
    properties,
    APP_CONFIG.attributeFieldCandidates.name,
    "Unnamed place"
  );
}

function getPlaceDescription(properties) {
  return getFirstAvailableProperty(
    properties,
    APP_CONFIG.attributeFieldCandidates.description,
    null
  );
}

function getPlaceCategory(properties) {
  return getFirstAvailableProperty(
    properties,
    APP_CONFIG.attributeFieldCandidates.category,
    null
  );
}

// --------------------------------------------------------------------
// COORDINATE VALIDATION
// --------------------------------------------------------------------
function isValidLat(lat) {
  const n = Number(lat);
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

function isValidLng(lng) {
  const n = Number(lng);
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

function isValidCoordinate(lat, lng) {
  return isValidLat(lat) && isValidLng(lng);
}

// Soft warning only - does not block a submission, just flags it so the
// UI can show "this looks far from Sri Lanka, please check".
function isWithinSriLankaRoughly(lat, lng) {
  const b = APP_CONFIG.map.sriLankaRoughBounds;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

// --------------------------------------------------------------------
// DISTANCE (Near Me, and the duplicate-place check)
// --------------------------------------------------------------------
// Returns straight-line ("as the crow flies") distance in kilometres.
// NOTE FOR VIVA: this is NOT road-network / walking distance. A true
// network distance would need a routing engine (e.g. OSRM) which this
// client-side-only project does not include.
function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // Earth's radius in kilometres
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(km) {
  if (km < 1) return Math.round(km * 1000) + " m";
  return km.toFixed(1) + " km";
}

// --------------------------------------------------------------------
// SAFE HTML (never trust text coming from a Google Sheet)
// --------------------------------------------------------------------
function escapeHTML(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --------------------------------------------------------------------
// MEDIA VALIDATION
// --------------------------------------------------------------------
function isValidImageURL(url) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  return /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(trimmed) ||
         trimmed.includes("drive.google.com") ||
         trimmed.includes("googleusercontent.com");
}

function isValidYouTubeURL(url) {
  if (!url || typeof url !== "string") return false;
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/i.test(url.trim());
}

// Converts a normal YouTube watch/short URL into an embeddable URL.
// Returns null if the URL is not a recognised YouTube link.
function getYouTubeEmbedURL(url) {
  if (!isValidYouTubeURL(url)) return null;
  let videoId = null;
  const watchMatch = url.match(/[?&]v=([^&]+)/);
  const shortMatch = url.match(/youtu\.be\/([^?&]+)/);
  if (watchMatch) videoId = watchMatch[1];
  else if (shortMatch) videoId = shortMatch[1];
  if (!videoId) return null;
  return "https://www.youtube.com/embed/" + encodeURIComponent(videoId);
}

// --------------------------------------------------------------------
// MISC
// --------------------------------------------------------------------
function uid(prefix) {
  return (prefix || "id") + "_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
}

// Delays calling fn until `wait` ms after the last call - used by the
// search box so it does not re-search on every single keystroke.
function debounce(fn, wait) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

// Reads a value that might be a number already or a string like "7.12"
// coming from a Google Sheet, and returns a clean JS number or NaN.
function toCleanNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  const cleaned = value.trim().replace(/,/g, "");
  return cleaned === "" ? NaN : Number(cleaned);
}

// A config value still equal to the placeholder text means the student
// has not pasted their real Apps Script URL in yet.
function isPlaceholderValue(value) {
  return !value || typeof value !== "string" || value.trim() === "" ||
    value.toUpperCase().startsWith("PASTE_");
}

// --------------------------------------------------------------------
// PHOTO COMPRESSION (section: anonymous direct photo upload)
// --------------------------------------------------------------------
// Takes a File object straight from an <input type="file">, validates
// its type/size, resizes it in the browser (via a <canvas>) so its
// longest side is at most uploadsConfig.maxDimensionPx, and re-encodes
// it as a JPEG at uploadsConfig.jpegQuality. This keeps the JSON payload
// we send to Apps Script small and keeps Google Drive storage usage
// reasonable, while a tourism-map photo still looks perfectly good at
// that size. Returns a Promise resolving to:
//   { base64, mimeType, previewDataURL, originalName }
// base64 has no "data:image/...;base64," prefix - that part is stripped
// so it is ready to send straight to Apps Script, which decodes it with
// Utilities.base64Decode().
function compressImageFile(file, uploadsConfig) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error("No file selected.")); return; }

    if (uploadsConfig.allowedTypes.indexOf(file.type) === -1) {
      reject(new Error("Unsupported file type. Please choose a JPEG, PNG or WEBP image."));
      return;
    }
    const maxBytes = uploadsConfig.maxOriginalFileSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      reject(new Error("That photo is too large (max " + uploadsConfig.maxOriginalFileSizeMB + " MB). Please choose a smaller file."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that photo file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file does not look like a valid image."));
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        const maxDim = uploadsConfig.maxDimensionPx;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round(height * (maxDim / width));
            width = maxDim;
          } else {
            width = Math.round(width * (maxDim / height));
            height = maxDim;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        // Always re-encode as JPEG - this is what actually shrinks the
        // file size. PNG/WEBP originals are simply converted; the user
        // never notices, since the project only needs ONE displayable
        // photo per place, not a lossless archival copy.
        const dataURL = canvas.toDataURL("image/jpeg", uploadsConfig.jpegQuality);
        const base64 = dataURL.split(",")[1];

        resolve({ base64, mimeType: "image/jpeg", previewDataURL: dataURL, originalName: file.name });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// --------------------------------------------------------------------
// SUBMITTING DATA TO APPS SCRIPT
// --------------------------------------------------------------------
// Used by place-form.js (Add/Edit Place), participation.js (Report an
// Issue) and feedback.js (Give Feedback) - the ONLY three places in this
// whole project that write data.
//
// IMPORTANT TECHNICAL NOTE (for the viva): Apps Script Web Apps do not
// implement a CORS "preflight" (OPTIONS request) response the way a
// normal REST API would. The browser only sends a preflight before a
// request that is NOT a "simple request". A POST whose Content-Type is
// "text/plain" (instead of "application/json") still counts as simple,
// so the browser sends the POST directly, with no preflight - and Apps
// Script's doPost(e) receives our JSON perfectly well through
// e.postData.contents, it just has to JSON.parse() that text itself
// instead of relying on a JSON content-type header. That is exactly
// what google-apps-script/Code.gs does. This is why the header below is
// deliberately "text/plain", not "application/json" - using
// "application/json" here would trigger a preflight that a plain Apps
// Script deployment does not answer, and the request would fail with a
// CORS error in the browser console.
async function postToAppsScript(apiURL, payload) {
  const response = await fetch(apiURL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("HTTP " + response.status + " from the server.");
  }
  return response.json();
}

// --------------------------------------------------------------------
// SIMPLE TEXT SIMILARITY (possible-duplicate warning only - never blocks
// a submission, see place-form.js)
// --------------------------------------------------------------------
// A small, easy-to-explain similarity measure: the Sorensen-Dice
// coefficient over character bigrams. 1.0 means identical text, 0 means
// no two-letter sequences in common. Good enough to catch near-duplicate
// names like "Mount Lavinia Beach" vs "Mt Lavinia Beach" without needing
// any external library.
function textSimilarity(a, b) {
  function bigramsOf(s) {
    const clean = String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const pairs = [];
    for (let i = 0; i < clean.length - 1; i++) pairs.push(clean.substring(i, i + 2));
    return pairs;
  }
  const bigramsA = bigramsOf(a);
  const bigramsB = bigramsOf(b);
  if (bigramsA.length === 0 || bigramsB.length === 0) return 0;

  const remainingB = bigramsB.slice();
  let matches = 0;
  bigramsA.forEach((pair) => {
    const idx = remainingB.indexOf(pair);
    if (idx !== -1) {
      matches++;
      remainingB.splice(idx, 1);
    }
  });
  return (2 * matches) / (bigramsA.length + bigramsB.length);
}

// --------------------------------------------------------------------
// APP MODAL - the ONE reusable form shell (#appModal in index.html)
// --------------------------------------------------------------------
// place-form.js (Add/Edit Place), feedback.js (Give Feedback) and
// participation.js (Report an Issue) all call AppModal.open(title) to
// get an empty container to build their form into, and AppModal.close()
// when they are done. None of those three files know about each other,
// and none of them contain any modal/overlay markup of their own.
const AppModal = (function () {
  function open(title) {
    const overlay = document.getElementById("appModal");
    const titleEl = document.getElementById("appModalTitle");
    const bodyEl = document.getElementById("appModalBody");
    if (!overlay || !titleEl || !bodyEl) return null;
    titleEl.textContent = title;
    bodyEl.innerHTML = "";
    overlay.hidden = false;
    return bodyEl;
  }

  function close() {
    const overlay = document.getElementById("appModal");
    const bodyEl = document.getElementById("appModalBody");
    if (overlay) overlay.hidden = true;
    if (bodyEl) bodyEl.innerHTML = ""; // drop the form so its listeners are freed
  }

  function getBody() {
    return document.getElementById("appModalBody");
  }

  function wireCloseButton() {
    const closeBtn = document.getElementById("appModalCloseBtn");
    const overlay = document.getElementById("appModal");
    if (closeBtn) closeBtn.addEventListener("click", close);
    // Clicking the dark background (not the white card itself) also closes it.
    if (overlay) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
      });
    }
  }

  return { open, close, getBody, wireCloseButton };
})();

// The close button only needs to be wired once, and does not depend on
// any other file, so we do it right here rather than waiting for ui.js.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", AppModal.wireCloseButton);
} else {
  AppModal.wireCloseButton();
}
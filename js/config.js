/*
FILE PURPOSE: Single place to configure the whole application.
WHAT THIS FILE DOES:
  - Holds map starting position and basemap choices.
  - Lists every existing GIS dataset (the 17 GeoJSON files) with its
    display name, icon, colour group and filter category, so that no
    other file needs to repeat this information.
  - Holds the CATEGORY SCHEMA for the 11 participatory tourism datasets
    (Restaurants, Accommodation, Beaches, Heritage, Parks, Diving, Shops,
    Banks/ATM, Attractions, Museums, Viewpoints). This schema is the
    single source of truth that js/place-form.js uses to build the
    dynamic Add/Edit form for whichever category the user picks, and
    that js/layers.js uses to build category-correct popups. Add a field
    here and it appears in the form and the popup automatically - you
    never edit 11 separate forms.
  - Holds the field options for the in-page "Give Feedback" and
    "Report an Issue" forms.
  - Holds the Google Apps Script Web App URL that is the ONLY backend
    this project talks to (no Google Forms anywhere any more).
  - Holds upload limits used when a user attaches a photo.
MAIN FUNCTIONS: none (this file only defines the APP_CONFIG object).
DEPENDENCIES: none. Must be loaded BEFORE every other js/ file.
--------------------------------------------------------------------------
HOW TO EDIT THIS FILE
  1. After running setupCoastConnect() in Apps Script (see
     google-apps-script/README_Google_Setup.md) and deploying it, paste
     the Web App URL into APP_CONFIG.googleAppsScript.apiURL below.
  2. If you rename or add a GeoJSON file, add/update a row in
     APP_CONFIG.dataFiles - every other file (data-loader.js, layers.js,
     search.js, ui.js, analytics.js) reads this list in a loop instead
     of having 17 copies of the same code.
  3. If you want to change a question on the Add/Edit Place form, edit
     the matching entry's "fields" array in APP_CONFIG.editableCategories
     below - nothing else needs to change.
--------------------------------------------------------------------------
*/

const APP_CONFIG = {

  // ------------------------------------------------------------------
  // MAP SETTINGS
  // ------------------------------------------------------------------
  map: {
    // Centre point roughly in the middle of Western Province, Sri Lanka.
    initialCenter: [6.93, 79.93],
    initialZoom: 10,

    // Used until wp.geojson (Western Province boundary) loads successfully.
    fallbackBounds: [
      [6.30, 79.60], // south-west corner (lat, lng)
      [7.45, 80.25]  // north-east corner (lat, lng)
    ],

    // Rough bounding box used only as a soft sanity check for community
    // submitted coordinates (see utils.js -> isWithinSriLankaRoughly).
    sriLankaRoughBounds: {
      minLat: 5.5, maxLat: 10.0,
      minLng: 79.3, maxLng: 82.1
    },

    basemaps: {
      "OpenStreetMap": {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      },
      "CartoDB Positron": {
        url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19
      },
      "CartoDB Dark Matter": {
        url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19
      }
    },
    defaultBasemap: "OpenStreetMap"
  },

  // ------------------------------------------------------------------
  // EXISTING GIS DATASETS (converted from your shapefiles to GeoJSON)
  // ------------------------------------------------------------------
  // geometryType: "point" | "line" | "polygon" | "boundary"
  // group: used to build the Layers panel sections
  // filterTags: used by the Explore / Filter buttons AND Quick Discovery
  //   (both read from the SAME tag system - see LayerManager.
  //   applyCategoryFilter in layers.js). IMPORTANT: every editable
  //   tourism category below now has its OWN EXCLUSIVE tag (no two
  //   editable categories ever share a tag any more) - this was a real
  //   bug (UI/UX refinement): "attractions" used to carry
  //   ["beaches","heritage","nature"], which made Other Attractions
  //   incorrectly appear under three unrelated filter buttons, and
  //   Museums/Banks-ATM used to share tags with Heritage Sites/Shops for
  //   the same reason. Exact one-tag-per-category now avoids that
  //   category entirely.
  // icon: a Font Awesome class (loaded in index.html)
  // searchable: whether this layer is included in the name search
  // The 11 datasets whose "id" also appears as a key in
  // APP_CONFIG.editableCategories below are the PARTICIPATORY datasets -
  // they support Add Place / Edit Information. The other 6 (wp, cities,
  // roads, railway, transport, water) are informational only.
  dataFiles: [
    { id: "wp", name: "Western Province Boundary", file: "data/wp.geojson",
      geometryType: "boundary", group: "Base", icon: "fa-draw-polygon",
      filterTags: [], searchable: false, color: "#4b5563" },

    { id: "cities", name: "Cities / Towns", file: "data/cities.geojson",
      geometryType: "point", group: "Transport and Accessibility", icon: "fa-city",
      filterTags: ["transport"], searchable: true, color: "#334155" },

    { id: "beaches", name: "Beaches", file: "data/beaches.geojson",
      geometryType: "point", group: "Tourism Attractions", icon: "fa-umbrella-beach",
      filterTags: ["beaches"], searchable: true, color: "#0284c7" },

    { id: "heritage_sites", name: "Heritage Sites", file: "data/heritage_sites.geojson",
      geometryType: "point", group: "Tourism Attractions", icon: "fa-landmark",
      filterTags: ["heritage"], searchable: true, color: "#92400e" },

    // CHANGED (bug fix): was filterTags: ["heritage"] - shared with
    // Heritage Sites, so selecting the Heritage filter also showed
    // Museums. Now its own exclusive tag, per the user's explicit
    // request to keep Heritage Sites and Museums as separate options.
    { id: "museums", name: "Museums", file: "data/museums.geojson",
      geometryType: "point", group: "Tourism Attractions", icon: "fa-building-columns",
      filterTags: ["museums"], searchable: true, color: "#78350f" },

    { id: "parks", name: "Parks / Nature", file: "data/parks.geojson",
      geometryType: "point", group: "Tourism Attractions", icon: "fa-tree",
      filterTags: ["nature"], searchable: true, color: "#15803d" },

    { id: "viewpoints", name: "Viewpoints", file: "data/viewpoints.geojson",
      geometryType: "point", group: "Tourism Attractions", icon: "fa-binoculars",
      filterTags: ["viewpoints"], searchable: true, color: "#6d28d9" },

    { id: "diving_spots", name: "Diving / Marine Activity Spots", file: "data/diving_spots.geojson",
      geometryType: "point", group: "Tourism Attractions", icon: "fa-person-swimming",
      filterTags: ["diving"], searchable: true, color: "#0891b2" },

    // CHANGED (bug fix): was filterTags: ["beaches", "heritage", "nature"]
    // - the actual root cause of "Other Attractions appears under
    // unrelated filters/Quick Discovery". Now its own exclusive tag.
    { id: "attractions", name: "Other Attractions", file: "data/attractions.geojson",
      geometryType: "point", group: "Tourism Attractions", icon: "fa-star",
      filterTags: ["attractions"], searchable: true, color: "#b45309" },

    { id: "accommodation", name: "Accommodation", file: "data/accommodation.geojson",
      geometryType: "point", group: "Tourism Services", icon: "fa-bed",
      filterTags: ["accommodation"], searchable: true, color: "#7c3aed" },

    { id: "restaurants", name: "Restaurants", file: "data/restaurants.geojson",
      geometryType: "point", group: "Tourism Services", icon: "fa-utensils",
      filterTags: ["food"], searchable: true, color: "#dc2626" },

    // CHANGED (bug fix): was filterTags: ["shopping"] - shared with
    // Banks/ATMs. Now its own exclusive tag, per the user's request to
    // keep Shops and Banks/ATMs as separate options.
    { id: "shops", name: "Shops", file: "data/shops.geojson",
      geometryType: "point", group: "Tourism Services", icon: "fa-bag-shopping",
      filterTags: ["shops"], searchable: true, color: "#ea580c" },

    // CHANGED (bug fix): was filterTags: ["shopping"] - shared with Shops.
    { id: "banks_atm", name: "Banks and ATMs", file: "data/banks_atm.geojson",
      geometryType: "point", group: "Tourism Services", icon: "fa-money-bill-wave",
      filterTags: ["banks_atm"], searchable: true, color: "#166534" },

    { id: "roads", name: "Roads", file: "data/roads.geojson",
      geometryType: "line", group: "Transport and Accessibility", icon: "fa-road",
      filterTags: ["transport"], searchable: false, color: "#525252" },

    { id: "railway", name: "Railway", file: "data/railway.geojson",
      geometryType: "line", group: "Transport and Accessibility", icon: "fa-train",
      filterTags: ["transport"], searchable: false, color: "#1d4ed8" },

    { id: "transport", name: "Public Transport", file: "data/transport.geojson",
      geometryType: "point", group: "Transport and Accessibility", icon: "fa-bus",
      filterTags: ["transport"], searchable: true, color: "#1e40af" },

    { id: "water", name: "Water", file: "data/water.geojson",
      geometryType: "polygon", group: "Natural Features", icon: "fa-water",
      filterTags: ["nature"], searchable: false, color: "#0ea5e9" }
  ],

  // ------------------------------------------------------------------
  // ROAD HIERARCHY (scale-dependent road cartography - UI/UX refinement)
  // ------------------------------------------------------------------
  // Only the "roads" dataset uses this (railway keeps its own simple
  // single-style line, unchanged, since it is one line type, not a mix
  // of road classes). js/layers.js reads this to decide, per feature:
  //   1. which property on the feature actually holds its road class
  //      (classFieldCandidates - tried in order, first one present wins -
  //      we do NOT assume your roads.geojson uses "highway", since OSM-
  //      style exports, government GIS exports and hand-digitised QGIS
  //      layers all use different column names for this)
  //   2. which of the 4 cartographic tiers that raw value belongs to
  //      (each tier's "classes" list - edit these if your dataset's
  //      actual class values differ from the OSM-style ones assumed here)
  //   3. at what zoom level that tier becomes visible (minZoom) and what
  //      it looks like (style) - a feature whose class value matches
  //      nothing in any tier's "classes" list falls back to the "local"
  //      tier, a safe middle ground (not so early it clutters the
  //      regional view, not so late it silently disappears).
  // Edit this ONE block to retune the whole road hierarchy - nothing
  // else in the project needs to change.
  // ------------------------------------------------------------------
  roadHierarchy: {
    classFieldCandidates: [
      "highway", "fclass", "class", "road_type", "type",
      "ROAD_CLASS", "Road_Class", "CLASS", "TYPE", "ROAD_TYPE"
    ],
    tiers: [
      {
        key: "major",
        label: "Major Roads",
        minZoom: 0, // always visible once Roads is turned on
        classes: ["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link"],
        style: { color: "#9c7a4d", weight: 3.4, opacity: 0.85 }
      },
      {
        key: "medium",
        label: "Secondary Roads",
        minZoom: 11, // regional -> city transition (initialZoom above is 10)
        classes: ["secondary", "secondary_link", "tertiary", "tertiary_link"],
        style: { color: "#b9a37d", weight: 2.1, opacity: 0.75 }
      },
      {
        key: "local",
        label: "Local Roads",
        minZoom: 13, // city -> neighbourhood detail
        classes: ["residential", "unclassified", "living_street", "service"],
        style: { color: "#b7b7b7", weight: 1.3, opacity: 0.65 }
      },
      {
        key: "minor",
        label: "Minor / Paths",
        minZoom: 15, // closest zoom - footpaths, tracks, cycleways
        classes: [
          "track", "track_grade1", "track_grade2", "track_grade3", "track_grade4", "track_grade5",
          "path", "footway", "cycleway", "pedestrian", "steps", "bridleway"
        ],
        style: { color: "#d8d8d8", weight: 0.7, opacity: 0.55 }
      }
    ]
  },

  // ------------------------------------------------------------------
  // POI PROGRESSIVE ZOOM REVEAL (cartographic/UI-UX refinement)
  // ------------------------------------------------------------------
  // Replaces a single global "show tourism points from zoom N" switch.
  // Each of the 11 editable tourism categories gets its OWN minimum
  // zoom level, keyed by its EXACT category id (matching dataFiles[].id
  // and editableCategories' keys everywhere else in the project - never
  // a loose/shared group label). js/layers.js's getCategoryMinZoom(id)
  // reads this table; below that zoom, the category's markers are never
  // added to the map regardless of Filter/Quick Discovery/Layers-panel
  // state. A category id with no entry here falls back to 13 (the
  // mid-tier value) rather than failing - see getCategoryMinZoom().
  // "cities" is deliberately NOT listed here - Cities is handled as its
  // own always-visible-at-regional-scale case, separate from this table
  // entirely (see layers.js's buildInformationalPointLayer, unchanged).
  // Edit this ONE table to retune the whole progressive reveal - nothing
  // else in the project needs to change.
  // ------------------------------------------------------------------
  poiZoomLevels: {
    // Sub-regional scale - the first, most important tourism layer tier.
    beaches: 11,
    heritage_sites: 11,
    parks: 11,
    museums: 11,

    // Urban/local scale - where visitors plan where to stay/do activities.
    accommodation: 13,
    viewpoints: 13,
    diving_spots: 13,
    attractions: 13,

    // Neighbourhood scale - day-to-day tourism services.
    restaurants: 14,
    shops: 14,

    // Closest/local-detail scale.
    banks_atm: 15
  },

  // ------------------------------------------------------------------
  // FILTER BUTTONS shown in the Explore / Filter panel
  // key must match a filterTags entry above. Also doubles as the set of
  // valid Quick Discovery keys (index.html's .cc-quick-btn elements use
  // the same key values in their data-filter attribute).
  // ------------------------------------------------------------------
  filters: [
    { key: "beaches", label: "Beaches", icon: "fa-umbrella-beach" },
    { key: "heritage", label: "Heritage Sites", icon: "fa-landmark" },
    { key: "museums", label: "Museums", icon: "fa-building-columns" },
    { key: "nature", label: "Nature", icon: "fa-tree" },
    { key: "diving", label: "Diving", icon: "fa-person-swimming" },
    { key: "viewpoints", label: "Viewpoints", icon: "fa-binoculars" },
    { key: "attractions", label: "Other Attractions", icon: "fa-star" },
    { key: "food", label: "Food", icon: "fa-utensils" },
    { key: "accommodation", label: "Accommodation", icon: "fa-bed" },
    { key: "shops", label: "Shops", icon: "fa-bag-shopping" },
    { key: "banks_atm", label: "Banks & ATMs", icon: "fa-money-bill-wave" },
    { key: "transport", label: "Transport", icon: "fa-bus" }
  ],

  // ------------------------------------------------------------------
  // ATTRIBUTE FIELD NAMES TO TRY, IN ORDER
  // Your 17 shapefiles may not all use the same column name for the
  // same idea, so every place we read "the name" we try this list of
  // possible field names until one has a value. This is only used as a
  // BACKWARD-COMPATIBILITY fallback for datasets that have not yet been
  // updated to the new standard column names (name, desc, address, ...).
  // ------------------------------------------------------------------
  attributeFieldCandidates: {
    name: ["name", "Name", "NAME", "name_en", "Name_En", "title", "Title", "PLACE_NAME", "place_name"],
    description: ["desc", "description", "Description", "DESC", "notes", "Notes", "remarks", "Remarks"],
    category: ["category", "Category", "CATEGORY", "type", "Type", "TYPE"],
    openingHours: ["opening_hours", "OpeningHours", "hours", "Hours"],
    contact: ["contact", "Contact", "phone", "Phone", "tel", "Tel"],
    accessibility: ["accessibility", "Accessibility", "access", "Access"]
  },

  // ------------------------------------------------------------------
  // EDITABLE TOURISM CATEGORIES (participatory Add Place / Edit Information)
  // ------------------------------------------------------------------
  // Each key below MUST match a dataset "id" in APP_CONFIG.dataFiles.
  //   label          - shown in the category picker and on badges
  //   sheetTab       - the exact Google Sheet tab name (must match
  //                    Code.gs's SHEET_NAMES and what setupCoastConnect()
  //                    creates)
  //   placeIdPrefix  - prefix Code.gs uses when generating a place_id
  //                    for a brand new place in this category
  //   action         - the ?action= value used to GET this category's
  //                    current community records from Apps Script
  //   fields         - the category-specific questions shown on the
  //                    dynamic Add/Edit form, AFTER the universal
  //                    Name / Description fields that every category has.
  //                    type: "text" | "url" | "textarea" | "select"
  // Universal fields every category always has, in this order, are NOT
  // repeated here - they are built into place-form.js itself:
  //   name (text, required), address (text, optional - unless a
  //   category below removes it by setting hasAddress:false),
  //   website (url, optional - only if hasWebsite:true),
  //   desc (textarea), then this category's own fields, then Photo.
  // ------------------------------------------------------------------
  editableCategoryOrder: [
    "restaurants", "accommodation", "beaches", "heritage_sites", "parks",
    "diving_spots", "shops", "banks_atm", "attractions", "museums", "viewpoints"
  ],

  editableCategories: {

    restaurants: {
      label: "Restaurant",
      sheetTab: "Restaurants",
      placeIdPrefix: "RES",
      action: "restaurants",
      nameLabel: "Restaurant Name",
      hasAddress: true,
      hasWebsite: true,
      descRequired: true,
      fields: [
        { key: "dine_in", label: "Dine In", type: "select", required: false, options: ["Yes", "No", "Unknown"] },
        { key: "takeaway", label: "Takeaway", type: "select", required: false, options: ["Yes", "No", "Unknown"] },
        { key: "delivery", label: "Delivery", type: "select", required: false, options: ["Yes", "No", "Unknown"] }
      ]
    },

    accommodation: {
      label: "Accommodation",
      sheetTab: "Accommodation",
      placeIdPrefix: "ACC",
      action: "accommodation",
      nameLabel: "Accommodation Name",
      hasAddress: true,
      hasWebsite: true,
      descRequired: true,
      fields: [
        { key: "acc_type", label: "Accommodation Type", type: "select", required: false,
          options: ["Hotel", "Resort", "Guest House", "Homestay", "Hostel", "Villa", "Other"] },
        { key: "price_rng", label: "Price Range", type: "select", required: false,
          options: ["Budget", "Moderate", "High", "Unknown"] }
      ]
    },

    beaches: {
      label: "Beach",
      sheetTab: "Beaches",
      placeIdPrefix: "BEA",
      action: "beaches",
      nameLabel: "Beach Name",
      addressLabel: "Address / Access Location",
      hasAddress: true,
      hasWebsite: false,
      descRequired: true,
      fields: [
        { key: "swim_suit", label: "Swimming Suitability", type: "select", required: false,
          options: ["Suitable", "Not Suitable", "Unknown"] },
        { key: "toilets", label: "Toilets", type: "select", required: false, options: ["Yes", "No", "Unknown"] },
        { key: "change_fac", label: "Changing Facilities", type: "select", required: false, options: ["Yes", "No", "Unknown"] },
        { key: "parking", label: "Parking", type: "select", required: false, options: ["Yes", "No", "Unknown"] }
      ]
    },

    heritage_sites: {
      label: "Heritage Site",
      sheetTab: "Heritage",
      placeIdPrefix: "HER",
      action: "heritage",
      nameLabel: "Heritage Site Name",
      hasAddress: true,
      hasWebsite: true,
      descRequired: true,
      fields: [
        { key: "herit_type", label: "Heritage Type", type: "select", required: false,
          options: ["Building", "Monument", "Religious Site", "Fortification", "Archaeological Site",
            "Industrial Heritage", "Cultural Site", "Other"] }
      ]
    },

    parks: {
      label: "Park",
      sheetTab: "Parks",
      placeIdPrefix: "PAR",
      action: "parks",
      nameLabel: "Park Name",
      hasAddress: true,
      hasWebsite: true,
      descRequired: true,
      fields: [
        { key: "park_type", label: "Park Type", type: "select", required: false,
          options: ["Urban Park", "Recreational Park", "Nature Park", "Wetland / Ecological Park", "Children's Park", "Other"] },
        { key: "toilets", label: "Toilets", type: "select", required: false, options: ["Yes", "No", "Unknown"] },
        { key: "parking", label: "Parking", type: "select", required: false, options: ["Yes", "No", "Unknown"] }
      ]
    },

    diving_spots: {
      label: "Diving Spot",
      sheetTab: "Diving",
      placeIdPrefix: "DIV",
      action: "diving",
      nameLabel: "Diving Spot Name",
      hasAddress: false, // no street address for dive sites - coordinates matter most
      hasWebsite: false,
      descRequired: true,
      fields: [
        { key: "operator", label: "Operator Available", type: "select", required: false, options: ["Yes", "No", "Unknown"] },
        { key: "safety_inf", label: "Safety Information", type: "textarea", required: false }
      ]
    },

    shops: {
      label: "Shop",
      sheetTab: "Shops",
      placeIdPrefix: "SHP",
      action: "shops",
      nameLabel: "Shop Name",
      hasAddress: true,
      hasWebsite: true,
      descRequired: true,
      fields: [
        { key: "shop_type", label: "Shop Type", type: "select", required: false,
          options: ["Souvenir", "Handicraft", "Clothing", "Local Products", "Convenience", "Shopping Centre", "Other"] }
      ]
    },

    banks_atm: {
      label: "Bank / ATM",
      sheetTab: "Banks_ATM",
      placeIdPrefix: "BNK",
      action: "banks",
      nameLabel: "Bank / ATM Name",
      hasAddress: true,
      hasWebsite: true,
      descRequired: false, // the only category where Short Description is optional
      fields: [
        { key: "atm_avail", label: "ATM Available", type: "select", required: false, options: ["Yes", "No", "Unknown"] }
      ]
    },

    attractions: {
      label: "Other Attraction",
      sheetTab: "Attractions",
      placeIdPrefix: "ATR",
      action: "attractions",
      nameLabel: "Attraction Name",
      addressLabel: "Address / Location",
      hasAddress: true,
      hasWebsite: true,
      descRequired: true,
      fields: [
        { key: "attr_type", label: "Attraction Type", type: "select", required: false,
          options: ["Religious", "Cultural", "Nature", "Recreation", "Water Activity", "Entertainment", "Community Attraction", "Other"] }
      ]
    },

    museums: {
      label: "Museum",
      sheetTab: "Museums",
      placeIdPrefix: "MUS",
      action: "museums",
      nameLabel: "Museum Name",
      hasAddress: true,
      hasWebsite: true,
      descRequired: true,
      fields: [] // no extra category-specific field
    },

    viewpoints: {
      label: "Viewpoint",
      sheetTab: "Viewpoints",
      placeIdPrefix: "VPT",
      action: "viewpoints",
      nameLabel: "Viewpoint Name",
      addressLabel: "Address / Access Location",
      hasAddress: true,
      hasWebsite: false,
      descRequired: true,
      fields: [] // no extra category-specific field
    }
  },

  // ------------------------------------------------------------------
  // REPORT AN ISSUE (in-page form, no Google Form, no approval gate)
  // ------------------------------------------------------------------
  issueReport: {
    sheetTab: "Issues",
    action: "issues", // used for both GET (?action=issues) and as the
                       // "kind" of POST submission (action: "issue")
    categories: [
      "Waste / Cleanliness", "Poor Road Access", "Lack of Public Transport", "Parking Problem",
      "Pedestrian Accessibility", "Disability Accessibility Barrier", "Safety / Security",
      "Coastal Erosion", "Water Pollution", "Flooding / Drainage", "Overcrowding", "Noise",
      "Lack of Public Toilets", "Lack of Signage", "Environmental Degradation",
      "Poor Tourism Infrastructure", "Other"
    ],
    severities: ["Low", "Moderate", "High", "Critical"]
  },

  // ------------------------------------------------------------------
  // GIVE FEEDBACK (in-page form, no Google Form)
  // ------------------------------------------------------------------
  feedback: {
    sheetTab: "Feedback",
    action: "feedback",
    visitorTypes: ["Tourist", "Local Resident", "Business Owner", "Tourism Worker", "Student / Researcher", "Other"]
  },

  // ------------------------------------------------------------------
  // GOOGLE APPS SCRIPT (the ONLY backend - setup, reads and writes)
  // ------------------------------------------------------------------
  googleAppsScript: {
    // Paste the deployment URL you get after running setupCoastConnect()
    // and then "Deploy > New deployment > Web app" in Apps Script. It
    // ends in /exec. See google-apps-script/README_Google_Setup.md.
    apiURL: "https://script.google.com/macros/s/AKfycbwZ8rnzrCbpE_0Cc81nZXSDF_DsLMwgBj81ZwGiI55yDF-MaxtlBZx2y1NeNYCNmcg/exec",

    // How often (milliseconds) community data refreshes automatically
    // in the background. 0 = only load once on startup / on demand.
    refreshIntervalMs: 0
  },

  // ------------------------------------------------------------------
  // PHOTO UPLOAD LIMITS (direct anonymous upload, no Google login)
  // ------------------------------------------------------------------
  uploads: {
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    maxOriginalFileSizeMB: 10,   // reject anything bigger than this before compressing
    maxDimensionPx: 1600,        // longest side after client-side resize
    jpegQuality: 0.82            // compression quality used when re-encoding
  },

  // ------------------------------------------------------------------
  // DUPLICATE-PLACE WARNING (soft warning only, never blocks submission)
  // ------------------------------------------------------------------
  duplicateCheck: {
    maxDistanceMeters: 60,
    nameSimilarityThreshold: 0.6
  },

  // ------------------------------------------------------------------
  // MISC APP BEHAVIOUR
  // ------------------------------------------------------------------
  behaviour: {
    clusterPointLayers: true,     // use Leaflet MarkerCluster for point layers
    clusterDisableAtZoom: 16,     // stop clustering once zoomed in this far
    favouritesStorageKey: "coastconnect_favourites",
    maxSearchResults: 8
  }
};
/*
FILE PURPOSE: Turns the CURRENT merged tourism data, community issues and
  community feedback into the "Planning Insights" panel content - the
  Urban Informatics / Planning part of the assignment.
WHAT THIS FILE DOES:
  - Counts things that were ACTUALLY loaded - never invented numbers.
    Every count below comes from CommunityData.getAllCurrentRecords()
    (the merged existing + newly_added + updated picture from PART 5),
    CommunityData.getIssues(), or CommunityData.getFeedback() - never
    from the raw GeoJSON alone, so an edited or newly-added place is
    counted exactly once, under its current status, never as two
    separate places.
  - Draws four Chart.js charts: tourism places by category, a status
    breakdown (Existing / Community Added / Community Updated), issues
    by severity, and average feedback ratings.
  - Builds optional heatmap layers with Leaflet.heat.
  - Calculates a simple, fully transparent "Community-Based Planning
    Priority" score from reported issues - explicitly labelled as an
    exploratory student indicator, not an official planning model.
  - Calculates one honest "tourism service gap" observation using plain
    distance checks only, and reuses the priority-area method for a
    second one - no invented network analysis, no fabricated figures.
MAIN FUNCTIONS:
  Analytics.computeIndicators, Analytics.renderCharts,
  Analytics.buildHeatmapLayers, Analytics.computeCommunityPriorityAreas,
  Analytics.buildPriorityLayer, Analytics.computeServiceGapInsights
DEPENDENCIES: Chart.js (global Chart), Leaflet, Leaflet.heat (global
  L.heatLayer), config.js, utils.js, community-data.js
  (CommunityData.getAllCurrentRecords / getIssues / getFeedback).
--------------------------------------------------------------------------
CHART COLOUR NOTES (kept consistent with the rest of the app rather than
introducing a new palette): the status breakdown chart reuses the exact
colours already used for the "Community Added" / "Community Updated"
popup badges in css/style.css (#7c3aed / #d97706), plus a neutral slate
for "Existing", so a colour means the same thing everywhere in the app.
The severity doughnut keeps its existing green->red ordinal colours
(Low/Moderate/High/Critical already used the same way in the Issues
layer markers). Category and ratings charts are single-series bar charts
(one colour, no legend needed - the chart title names the series).
--------------------------------------------------------------------------
*/

const Analytics = (function () {

  const SEVERITY_WEIGHT = { Low: 1, Moderate: 2, High: 3, Critical: 4 };
  const ACCESSIBILITY_ISSUE_TYPES = [
    "Pedestrian Accessibility", "Disability Accessibility Barrier",
    "Lack of Public Transport", "Parking Problem"
  ];
  const INFRASTRUCTURE_ISSUE_TYPES = [
    "Poor Tourism Infrastructure", "Lack of Public Toilets", "Lack of Signage",
    "Poor Road Access"
  ];
  const ENVIRONMENTAL_ISSUE_TYPES = [
    "Coastal Erosion", "Water Pollution", "Flooding / Drainage",
    "Environmental Degradation", "Noise"
  ];

  const SERVICE_CATEGORY_IDS = ["accommodation", "restaurants", "shops", "banks_atm"];
  const ATTRACTION_CATEGORY_IDS = ["beaches", "heritage_sites", "museums", "parks", "viewpoints", "diving_spots", "attractions"];
  const NEARBY_SERVICE_RADIUS_KM = 1.0;

  let chartInstances = {};

  // ------------------------------------------------------------------
  // PLANNING INSIGHTS - BASIC INDICATORS
  // ------------------------------------------------------------------
  function computeIndicators() {
    const allRecords = (typeof CommunityData !== "undefined" && CommunityData.getAllCurrentRecords)
      ? CommunityData.getAllCurrentRecords() : {};
    const issues = (typeof CommunityData !== "undefined" && CommunityData.getIssues) ? CommunityData.getIssues() : [];
    const feedback = (typeof CommunityData !== "undefined" && CommunityData.getFeedback) ? CommunityData.getFeedback() : [];

    let existingPlaces = 0, newlyAddedPlaces = 0, updatedPlaces = 0;
    const tourismPlacesByCategory = {};

    APP_CONFIG.editableCategoryOrder.forEach((categoryId) => {
      const schema = APP_CONFIG.editableCategories[categoryId];
      const records = allRecords[categoryId] || [];
      tourismPlacesByCategory[schema.label] = records.length;
      records.forEach((place) => {
        if (place.status === "newly_added") newlyAddedPlaces++;
        else if (place.status === "updated") updatedPlaces++;
        else existingPlaces++;
      });
    });

    const totalCurrentPlaces = existingPlaces + newlyAddedPlaces + updatedPlaces;
    const highSeverityProblems = issues.filter((i) => i.severity === "High" || i.severity === "Critical").length;

    return {
      existingPlaces,
      newlyAddedPlaces,
      updatedPlaces,
      totalCurrentPlaces,
      communityFeedbackCount: feedback.length,
      totalIssuesReported: issues.length,
      highSeverityProblems,
      tourismPlacesByCategory,
      placeStatusCounts: {
        "Existing": existingPlaces,
        "Community Added": newlyAddedPlaces,
        "Community Updated": updatedPlaces
      },
      issuesBySeverity: countBy(issues, "severity"),
      averageRatings: averageRatings(feedback)
    };
  }

  function countBy(records, field) {
    const counts = {};
    records.forEach((r) => {
      const key = r[field] || "Other";
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }

  function averageRatings(feedback) {
    const fields = ["overallExperience", "accessibility", "cleanliness", "safety", "environmentalQuality", "touristFacilities"];
    const result = {};
    fields.forEach((field) => {
      const values = feedback.map((f) => f[field]).filter((v) => Number.isFinite(v));
      result[field] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    });
    return result;
  }

  // ------------------------------------------------------------------
  // CHART.JS CHARTS
  // ------------------------------------------------------------------
  // canvasIds = { category, placeStatus, issuesSeverity, ratings } - the
  // <canvas> element ids declared in index.html's Planning Insights panel.
  function renderCharts(canvasIds, indicators) {
    destroyCharts();

    renderBarChart(canvasIds.category, "Tourism Places by Category",
      Object.keys(indicators.tourismPlacesByCategory), Object.values(indicators.tourismPlacesByCategory), "#0284c7");

    renderDoughnutChart(canvasIds.placeStatus, "Places by Status",
      ["Existing", "Community Added", "Community Updated"],
      ["Existing", "Community Added", "Community Updated"].map((k) => indicators.placeStatusCounts[k] || 0),
      ["#64748b", "#7c3aed", "#d97706"]);

    renderDoughnutChart(canvasIds.issuesSeverity, "Reported Issues by Severity",
      ["Low", "Moderate", "High", "Critical"],
      ["Low", "Moderate", "High", "Critical"].map((s) => indicators.issuesBySeverity[s] || 0),
      ["#22c55e", "#eab308", "#f97316", "#dc2626"]);

    const ratingLabels = ["Overall", "Accessibility", "Cleanliness", "Safety", "Environmental Quality", "Tourist Facilities"];
    const ratingKeys = ["overallExperience", "accessibility", "cleanliness", "safety", "environmentalQuality", "touristFacilities"];
    renderBarChart(canvasIds.ratings, "Average Community Feedback Ratings (1-5)",
      ratingLabels, ratingKeys.map((k) => indicators.averageRatings[k]), "#7c3aed", 5);
  }

  function renderBarChart(canvasId, label, labels, data, color, suggestedMax) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (labels.length === 0) { showNoDataMessage(canvas, label); return; }

    chartInstances[canvasId] = new Chart(canvas, {
      type: "bar",
      data: { labels, datasets: [{ label, data, backgroundColor: color }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, title: { display: true, text: label } },
        scales: { y: { beginAtZero: true, suggestedMax: suggestedMax || undefined } }
      }
    });
  }

  function renderDoughnutChart(canvasId, label, labels, data, colors) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (data.every((v) => v === 0)) { showNoDataMessage(canvas, label); return; }

    chartInstances[canvasId] = new Chart(canvas, {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: colors }] },
      options: { responsive: true, plugins: { legend: { position: "bottom" }, title: { display: true, text: label } } }
    });
  }

  function showNoDataMessage(canvas, label) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#6b7280";
    ctx.textAlign = "center";
    ctx.fillText("No data yet for: " + label, canvas.width / 2, canvas.height / 2);
  }

  function destroyCharts() {
    Object.values(chartInstances).forEach((chart) => chart && chart.destroy && chart.destroy());
    chartInstances = {};
  }

  // ------------------------------------------------------------------
  // HEATMAPS (concentration only - not boundaries or planning zones)
  // ------------------------------------------------------------------
  function buildHeatmapLayers() {
    const allRecords = (typeof CommunityData !== "undefined" && CommunityData.getAllCurrentRecords)
      ? CommunityData.getAllCurrentRecords() : {};
    const issues = (typeof CommunityData !== "undefined" && CommunityData.getIssues) ? CommunityData.getIssues() : [];

    const tourismPoints = [];
    const communityPoints = [];
    Object.keys(allRecords).forEach((categoryId) => {
      allRecords[categoryId].forEach((place) => {
        tourismPoints.push([place.lat, place.lng, 0.6]);
        if (place.status !== "existing") communityPoints.push([place.lat, place.lng, 0.6]);
      });
    });

    const problems = issues.map((i) => [i.lat, i.lng, (SEVERITY_WEIGHT[i.severity] || 1) / 4]);
    const participation = communityPoints.concat(problems);

    return {
      tourismActivity: L.heatLayer(tourismPoints, { radius: 25, blur: 20 }),
      communityPlaces: L.heatLayer(communityPoints, { radius: 25, blur: 20, gradient: { 0.4: "#a78bfa", 1: "#4c1d95" } }),
      problems: L.heatLayer(problems, { radius: 25, blur: 20, gradient: { 0.4: "#fca5a5", 1: "#7f1d1d" } }),
      participation: L.heatLayer(participation, { radius: 25, blur: 20 })
    };
  }

  // ------------------------------------------------------------------
  // COMMUNITY-BASED PLANNING PRIORITY (exploratory, not official)
  // ------------------------------------------------------------------
  // METHOD (documented here for the viva):
  //   1. Reported issues are grouped into rough ~1.1km grid cells by
  //      rounding their coordinates to 2 decimal places. This is a
  //      simple way to find "areas" without a real administrative
  //      boundary layer, and is intentionally coarse.
  //   2. Each issue contributes a severity weight: Low=1, Moderate=2,
  //      High=3, Critical=4.
  //   3. A cell's priority score = the SUM of its issues' severity
  //      weights. This rewards both how serious and how numerous the
  //      reports in that area are.
  //   4. Score is classified into three bands:
  //        score <= 3   -> "Lower Priority"
  //        score 4-7    -> "Moderate Priority"
  //        score >= 8   -> "Higher Priority"
  //      These thresholds are a simple, transparent student choice -
  //      NOT a validated planning standard.
  function computeCommunityPriorityAreas() {
    const issues = (typeof CommunityData !== "undefined" && CommunityData.getIssues) ? CommunityData.getIssues() : [];
    const cells = {};

    issues.forEach((issue) => {
      const cellLat = Math.round(issue.lat * 100) / 100;
      const cellLng = Math.round(issue.lng * 100) / 100;
      const key = cellLat + "," + cellLng;

      if (!cells[key]) {
        cells[key] = {
          lat: cellLat, lng: cellLng, score: 0, reportCount: 0,
          accessibilityCount: 0, infrastructureCount: 0, environmentalCount: 0
        };
      }
      const cell = cells[key];
      cell.score += SEVERITY_WEIGHT[issue.severity] || 1;
      cell.reportCount += 1;
      if (ACCESSIBILITY_ISSUE_TYPES.includes(issue.issueType)) cell.accessibilityCount++;
      if (INFRASTRUCTURE_ISSUE_TYPES.includes(issue.issueType)) cell.infrastructureCount++;
      if (ENVIRONMENTAL_ISSUE_TYPES.includes(issue.issueType)) cell.environmentalCount++;
    });

    return Object.values(cells).map((cell) => ({
      ...cell,
      tier: cell.score >= 8 ? "Higher Priority" : cell.score >= 4 ? "Moderate Priority" : "Lower Priority"
    })).sort((a, b) => b.score - a.score);
  }

  function buildPriorityLayer(cells) {
    const colorByTier = { "Lower Priority": "#22c55e", "Moderate Priority": "#f59e0b", "Higher Priority": "#dc2626" };
    const group = L.layerGroup();
    cells.forEach((cell) => {
      const radius = 300 + cell.score * 80; // metres - purely visual scaling
      const circle = L.circle([cell.lat, cell.lng], {
        radius, color: colorByTier[cell.tier], fillColor: colorByTier[cell.tier],
        fillOpacity: 0.25, weight: 1.5
      });
      circle.bindPopup(
        "<strong>" + escapeHTML(cell.tier) + "</strong><br>" +
        "Priority score: " + cell.score + " (exploratory indicator)<br>" +
        "Reports in this area: " + cell.reportCount + "<br>" +
        "Accessibility-related: " + cell.accessibilityCount + "<br>" +
        "Infrastructure-related: " + cell.infrastructureCount + "<br>" +
        "Environmental-related: " + cell.environmentalCount +
        '<p class="cc-popup-disclaimer">This is an exploratory community-based indicator and not an official planning prioritisation model.</p>'
      );
      group.addLayer(circle);
    });
    return group;
  }

  // ------------------------------------------------------------------
  // TOURISM SERVICE GAP INTERPRETATION (honest, distance-based only)
  // ------------------------------------------------------------------
  function computeServiceGapInsights() {
    const allRecords = (typeof CommunityData !== "undefined" && CommunityData.getAllCurrentRecords)
      ? CommunityData.getAllCurrentRecords() : {};

    const servicePoints = [];
    SERVICE_CATEGORY_IDS.forEach((categoryId) => {
      (allRecords[categoryId] || []).forEach((place) => servicePoints.push([place.lat, place.lng]));
    });

    const attractionsWithLimitedServices = [];
    ATTRACTION_CATEGORY_IDS.forEach((categoryId) => {
      (allRecords[categoryId] || []).forEach((place) => {
        const nearbyCount = servicePoints.filter(([slat, slng]) =>
          haversineDistanceKm(place.lat, place.lng, slat, slng) <= NEARBY_SERVICE_RADIUS_KM
        ).length;
        if (nearbyCount === 0) attractionsWithLimitedServices.push(place.name);
      });
    });

    const priorityCells = computeCommunityPriorityAreas();
    const highActivityHighProblemAreas = priorityCells.filter((c) => c.reportCount >= 3).length;

    return {
      attractionsWithLimitedServicesCount: attractionsWithLimitedServices.length,
      attractionsWithLimitedServicesSample: attractionsWithLimitedServices.slice(0, 10),
      highActivityHighProblemAreas
    };
  }

  return {
    computeIndicators, renderCharts, buildHeatmapLayers,
    computeCommunityPriorityAreas, buildPriorityLayer, computeServiceGapInsights
  };
})();
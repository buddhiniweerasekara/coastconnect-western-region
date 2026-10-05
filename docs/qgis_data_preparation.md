# QGIS Data Preparation Guide

This document replaces `docs/google_form_structure.md` (deleted - there
are no Google Forms anywhere in this project anymore). It tells you
exactly what to do in QGIS, **before** exporting each of the 11 editable
tourism category GeoJSON files, so that `community-data.js`'s merge
engine (PART 5) can correctly tell an original place apart from a
community-added or community-edited one, and so a community *edit* to an
originally-existing place lands on the same place instead of creating a
duplicate.

This guide only concerns the **11 editable tourism categories**. The 6
informational-only layers (`wp`, `cities`, `roads`, `railway`,
`transport`, `water`) are never edited by the public, so none of this
applies to them - export those exactly as before (Section 6 of the main
`README.md`).

---

## 1. Why this matters (read this first)

Every row CoastConnect's Google Sheet ever holds is a **community**
submission - a brand-new place, or an edit to an existing one. The Sheet
never contains a copy of your original QGIS data. Instead, the browser
(`community-data.js`) merges two things together every time the map
loads a category:

1. Your original GeoJSON features (loaded by `data-loader.js`), treated
   as `status: "existing"`.
2. Whatever rows Apps Script returns for that category's Sheet tab
   (already resolved to "latest version only" - see `Code.gs`).

The merge is keyed on one property: **`place_id`**. If a community
member edits "Mount Lavinia Beach", the edit row's `place_id` must match
the `place_id` already sitting on that beach's GeoJSON feature, or the
edit will show up as a brand-new, duplicate place sitting right on top
of the original instead of updating it.

**If your GeoJSON features have no `place_id` property at all**, the app
does not crash - `community-data.js` generates a temporary ID
(`TEMP_<CATEGORY>_<index>`) so the map keeps working, and prints a
console warning. But a temporary ID is not stable (it depends on the
feature's position in the file, which can shift if you re-export), so
**any edit made before you add real `place_id`s will not merge correctly
once you do add them.** Do this step before your first real deployment,
not after.

---

## 2. What every editable category's GeoJSON needs

For **all 11** editable categories, every point feature's attribute
table needs these properties, using **exactly these lower-case,
underscore names** (not the form labels you see on-screen - those are
just display labels; the underlying property/column names below are
what the frontend and `Code.gs` both read):

| Property name | Required? | Notes |
|---|---|---|
| `place_id` | Yes (see above) | Must be unique within this one category's file. See Section 3 for how to generate it in QGIS. |
| `name` | Yes | The place's name. If missing, the place shows as "Unnamed place". |
| `description` | Only if the category requires a description (see table in Section 4 - every category except Banks/ATMs) | A short description shown in the popup. |
| `address` | Only for categories with an address field (see Section 4) | Optional even for those categories - leave blank if unknown. |
| `website` | Only for categories with a website field (see Section 4) | Optional - leave blank if unknown. |
| *(category-specific fields)* | Depends on category | Exact property names and allowed values are listed per category in Section 4. |

Geometry requirement: every feature must be a single **Point** (not
MultiPoint, not Polygon/Line). If QGIS reports any multi-part points in
a layer, run **Vector > Geometry Tools > Multipart to Singleparts**
before exporting. A non-Point feature in one of these 11 files is
silently skipped by the frontend (it will simply never appear on the
map), with no error shown - so check your QGIS geometry type before
exporting, not after you notice places are missing.

Coordinate requirement: same as the rest of the project - export with
**CRS: EPSG:4326 (WGS 84)**, per Section 6 of the main `README.md`. A
feature with a latitude outside -90..90 or a longitude outside -180..180
is treated as invalid and dropped.

---

## 3. Adding a stable `place_id` in QGIS

1. Open the layer's attribute table (right-click the layer -> **Open
   Attribute Table**).
2. Click **Toggle Editing** (the pencil icon), then **Open Field
   Calculator** (the abacus icon).
3. Tick **"Create a new field"**. Name it `place_id`, type **Text
   (string)**, length 20.
4. In the **Expression** box, use this pattern (replace `RES_` with the
   prefix for this category from the table in Section 4):


   
   `$id` is QGIS's built-in zero-based feature ID, so `$id + 1` numbers
   your features 1, 2, 3, ... and `lpad(..., 4, '0')` pads that to 4
   digits, producing `RES_0001`, `RES_0002`, and so on.
5. Click **OK**, then click **Toggle Editing** again and **Save** to
   write the new field to the layer.
6. Repeat for every one of the 11 editable-category layers, using that
   category's own prefix each time.

**Why a short sequential pattern like `RES_0001` is safe to use here:**
`Code.gs` generates IDs for brand-new community submissions using a
completely different, longer pattern - a timestamp plus a random suffix
(e.g. `RES_260215143022417`, see `generateId_()` in `Code.gs`) - so a
server-generated ID can never collide with one of your short QGIS IDs.
Just make sure every `place_id` is unique **within its own category's
file** (QGIS's `$id`-based numbering already guarantees this
automatically).

---

## 4. Property reference, per category

For each category: the prefix used in Section 3, whether it has an
`address` and/or `website` field, whether `description` is required,
and its category-specific property names with their expected values (to
keep popups looking consistent, try to match these exact option words -
but note the app does not reject an existing GeoJSON value that doesn't
match one of these words, it just displays whatever is there).

### Restaurants (`restaurants.geojson`) - prefix `RES`
`address`: yes · `website`: yes · `description`: required

| Property | Expected values |
|---|---|
| `dine_in` | Yes / No / Unknown |
| `takeaway` | Yes / No / Unknown |
| `delivery` | Yes / No / Unknown |

### Accommodation (`accommodation.geojson`) - prefix `ACC`
`address`: yes · `website`: yes · `description`: required

| Property | Expected values |
|---|---|
| `acc_type` | Hotel / Resort / Guest House / Homestay / Hostel / Villa / Other |
| `price_rng` | Budget / Moderate / High / Unknown |

### Beaches (`beaches.geojson`) - prefix `BEA`
`address`: yes (access location) · `website`: no · `description`: required

| Property | Expected values |
|---|---|
| `swim_suit` | Suitable / Not Suitable / Unknown |
| `toilets` | Yes / No / Unknown |
| `change_fac` | Yes / No / Unknown |
| `parking` | Yes / No / Unknown |

### Heritage Sites (`heritage_sites.geojson`) - prefix `HER`
`address`: yes · `website`: yes · `description`: required

| Property | Expected values |
|---|---|
| `herit_type` | Building / Monument / Religious Site / Fortification / Archaeological Site / Industrial Heritage / Cultural Site / Other |

### Parks (`parks.geojson`) - prefix `PAR`
`address`: yes · `website`: yes · `description`: required

| Property | Expected values |
|---|---|
| `park_type` | Urban Park / Recreational Park / Nature Park / Wetland / Ecological Park / Children's Park / Other |
| `toilets` | Yes / No / Unknown |
| `parking` | Yes / No / Unknown |

### Diving / Marine Activity Spots (`diving_spots.geojson`) - prefix `DIV`
`address`: no · `website`: no · `description`: required

| Property | Expected values |
|---|---|
| `operator` | Yes / No / Unknown |
| `safety_inf` | Free text (optional - may be left blank) |

### Shops (`shops.geojson`) - prefix `SHP`
`address`: yes · `website`: yes · `description`: required

| Property | Expected values |
|---|---|
| `shop_type` | Souvenir / Handicraft / Clothing / Local Products / Convenience / Shopping Centre / Other |

### Banks and ATMs (`banks_atm.geojson`) - prefix `BNK`
`address`: yes · `website`: yes · `description`: **optional** (the only category where this is not required)

| Property | Expected values |
|---|---|
| `atm_avail` | Yes / No / Unknown |

### Other Attractions (`attractions.geojson`) - prefix `ATR`
`address`: yes · `website`: yes · `description`: required

| Property | Expected values |
|---|---|
| `attr_type` | Religious / Cultural / Nature / Recreation / Water Activity / Entertainment / Community Attraction / Other |

### Museums (`museums.geojson`) - prefix `MUS`
`address`: yes · `website`: yes · `description`: required

No category-specific properties.

### Viewpoints (`viewpoints.geojson`) - prefix `VPT`
`address`: yes (access location) · `website`: no · `description`: required

No category-specific properties.

---

## 5. Checklist before you export

- [ ] Project CRS (and export CRS) is EPSG:4326.
- [ ] Geometry type is single Point for every feature (no MultiPoint).
- [ ] `place_id` added, text type, unique within this file, using this
      category's prefix.
- [ ] `name` filled in for every feature.
- [ ] `description` filled in for every feature, if this category
      requires it (every category except Banks/ATMs).
- [ ] `address` / `website` filled in where known (optional either way).
- [ ] Category-specific properties use the exact property names from
      Section 4.
- [ ] Exported as GeoJSON to `data/<category>.geojson` using the exact
      filename from the table in `README.md` Section 6.

## 6. How to tell if you missed a `place_id`

Open the browser console (F12) after loading the map. If any editable
category is missing `place_id` on some features, you will see:
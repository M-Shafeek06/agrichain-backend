const NodeGeocoder = require("node-geocoder");
const DISTRICT_COORDS = require("./districtCoords");

const geocoder = NodeGeocoder({
    provider: "openstreetmap"
});

const cache = Object.create(null);

async function getCoordinates(place) {
    try {
        if (!place || typeof place !== "string") return null;

        // 🔑 Normalize input (handle "Area, District" safely)
        const raw = place.trim();
        const primary = raw.split(",")[0].trim();      // e.g. "Vennamalai"
        const secondary = raw.includes(",")
            ? raw.split(",").pop().trim()               // e.g. "Karur"
            : null;

        // 🔁 Cache check (use full raw key to avoid collisions)
        if (cache[raw]) return cache[raw];

        /* =====================================================
           🔥 1. Direct district lookup (primary)
        ===================================================== */
        if (DISTRICT_COORDS[primary]) {
            cache[raw] = DISTRICT_COORDS[primary];
            return cache[raw];
        }

        /* =====================================================
           🔥 2. District fallback (secondary)
           Handles "Vennamalai, Karur"
        ===================================================== */
        if (secondary && DISTRICT_COORDS[secondary]) {
            cache[raw] = DISTRICT_COORDS[secondary];
            return cache[raw];
        }

        /* =====================================================
           🌐 3. OpenStreetMap fallback (India only)
        ===================================================== */
        const res = await geocoder.geocode({
            address: raw,
            country: "India"
        });

        if (!res || !res.length) return null;

        const coord = {
            lat: Number(res[0].latitude),
            lng: Number(res[0].longitude)
        };

        if (!coord.lat || !coord.lng) return null;

        /* 🇮🇳 Hard India geo-fence */
        if (
            coord.lat < 6 || coord.lat > 37 ||
            coord.lng < 68 || coord.lng > 97
        ) {
            return null;
        }

        cache[raw] = coord;
        return coord;

    } catch (err) {
        console.warn("Geo lookup failed for:", place);
        return null;
    }
}

module.exports = getCoordinates;

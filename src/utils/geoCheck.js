const haversine = require("haversine-distance");

/**
 * Accepts string locations OR { lat, lng } objects.
 * Falls back to similarity check if GPS is unavailable.
 */
module.exports = function geoCheck(prev, current) {
  if (!prev || !current) return true;

  // GPS based validation
  if (typeof prev === "object" && typeof current === "object") {
    if (prev.lat && prev.lng && current.lat && current.lng) {
      const dist =
        haversine(
          { latitude: prev.lat, longitude: prev.lng },
          { latitude: current.lat, longitude: current.lng }
        ) / 1000;

      return dist < 350; // km threshold
    }
  }

  // String-based fallback (global safe)
  const normalize = v =>
    v.toLowerCase().replace(/[^a-z\s]/g, "").trim();

  const a = normalize(prev);
  const b = normalize(current);

  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;

  return similarity(a, b) > 0.25;
};

/* Trigram similarity */
function similarity(a, b) {
  const grams = s =>
    new Set(Array.from({ length: s.length - 2 }, (_, i) => s.slice(i, i + 3)));

  const g1 = grams(a);
  const g2 = grams(b);

  const inter = [...g1].filter(x => g2.has(x)).length;
  const union = new Set([...g1, ...g2]).size;

  return union === 0 ? 0 : inter / union;
}

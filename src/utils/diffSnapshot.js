const IGNORED_FIELDS = [
  "priceAssignedBy",
  "priceAssignedAt",
  "verificationStatus",
  "verifiedBy",
  "verifiedAt",
  "adminRemark",
  "updatedAt",
  "createdAt",
  "_id",
  "__v"
];

/* 🔥 DEEP COMPARE FUNCTION */
function deepCompare(original, current, path = "") {
  const changes = [];

  const allKeys = new Set([
    ...Object.keys(original || {}),
    ...Object.keys(current || {})
  ]);

  for (const key of allKeys) {
    if (IGNORED_FIELDS.includes(key)) continue;

    const newPath = path ? `${path}.${key}` : key;

    const origVal = original ? original[key] : undefined;
    const currVal = current ? current[key] : undefined;

    if (
      typeof origVal === "object" &&
      origVal !== null &&
      typeof currVal === "object" &&
      currVal !== null
    ) {
      changes.push(...deepCompare(origVal, currVal, newPath));
    } else {
      if (JSON.stringify(origVal) !== JSON.stringify(currVal)) {
        changes.push({
          field: newPath,
          original: origVal,
          current: currVal
        });
      }
    }
  }

  return changes;
}

module.exports = function diffSnapshot(original, current) {
  return deepCompare(original, current);
};
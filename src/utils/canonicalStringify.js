module.exports = function canonicalStringify(obj) {
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalStringify).join(",") + "]";
  }

  if (obj !== null && typeof obj === "object") {
    return (
      "{" +
      Object.keys(obj)
        .sort()
        .map(key => `"${key}":${canonicalStringify(obj[key])}`)
        .join(",") +
      "}"
    );
  }

  return JSON.stringify(obj);
};

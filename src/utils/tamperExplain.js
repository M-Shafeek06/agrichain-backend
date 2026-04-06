function generateTamperExplanation({
    hashMismatch,
    editCount,
    geoValid,
    chainValid,
    priceDeviation
}) {

    const reasons = [];

    if (hashMismatch) {
        reasons.push("Blockchain hash mismatch detected");
    }

    if (editCount > 0) {
        reasons.push(`Record modified ${editCount} time(s)`);
    }

    if (!geoValid) {
        reasons.push("Geolocation validation failed");
    }

    if (!chainValid) {
        reasons.push("Shipment chain integrity broken");
    }

    if (priceDeviation > 0) {
        reasons.push("Abnormal price deviation detected");
    }

    if (reasons.length === 0) {
        return {
            status: "SAFE",
            explanation: "All blockchain, pricing, and logistics validations passed successfully"
        };
    }

    return {
        status: "TAMPERED",
        explanation: reasons.join("; ")
    };
}

module.exports = generateTamperExplanation;
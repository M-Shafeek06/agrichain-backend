function buildTransporterInvoice(data) {
    return {
        transporterName: data.transporterName || null,
        transporterId: data.transporterId || null,
        vehicleNumber: data.vehicleNumber || null,
        transportDate: data.transportDate
            ? new Date(data.transportDate).toISOString().split("T")[0]
            : null,
        charge: data.charge || 0,
        fromLocation: data.fromLocation || null,
        toLocation: data.toLocation || null,
        distributorId: data.distributorId || null,
        distributorName: data.distributorName || null,
        distributorLocation: data.distributorLocation || null,
        status: data.status || "PENDING"
    };
}

module.exports = buildTransporterInvoice;
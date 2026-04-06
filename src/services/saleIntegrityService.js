const crypto = require("crypto");
const SaleLog = require("../models/SaleLog");
const RetailerInventory = require("../models/RetailerInventory");
const { updateTrust } = require("./trustService"); // ✅ NEW

/* =========================================================
   🔐 GENERATE HASH
========================================================= */
function generateSaleHash(data) {
    const payload = JSON.stringify({
        inventoryId: data.inventoryId,
        retailerId: data.retailerId,
        batchId: data.batchId,
        cropName: data.cropName,

        quantitySold: data.quantitySold,
        remainingAfterSale: data.remainingAfterSale,

        basePerKgPrice: data.basePerKgPrice,
        retailerMarginPercent: data.retailerMarginPercent,
        finalPerKgPrice: data.finalPerKgPrice,

        totalSaleValue: data.totalSaleValue,
        profitEarned: data.profitEarned,

        previousHash: data.previousHash
    });

    return crypto
        .createHash("sha256")
        .update(payload)
        .digest("hex");
}

/* =========================================================
   🔍 VERIFY SALE LEDGER (CHAIN INTEGRITY)
========================================================= */
async function verifySaleLedger(inventoryId) {

    const inventory = await RetailerInventory.findOne({ inventoryId });

    const sales = await SaleLog
        .find({ inventoryId })
        .sort({ createdAt: 1 });

    let previousHash = inventory ? inventory.allocationHash : "GENESIS";

    for (const sale of sales) {

        const recalculated = generateSaleHash({
            inventoryId: sale.inventoryId,
            retailerId: sale.retailerId,
            batchId: sale.batchId,
            cropName: sale.cropName,

            quantitySold: sale.quantitySold,
            remainingAfterSale: sale.remainingAfterSale,

            basePerKgPrice: sale.basePerKgPrice,
            retailerMarginPercent: sale.retailerMarginPercent,
            finalPerKgPrice: sale.finalPerKgPrice,

            totalSaleValue: sale.totalSaleValue,
            profitEarned: sale.profitEarned,

            previousHash: previousHash
        });

        // ❌ Hash mismatch
        if (recalculated !== sale.saleHash) {
            return false;
        }

        // ❌ Chain broken
        if (sale.previousHash !== previousHash) {
            return false;
        }

        previousHash = sale.saleHash;
    }

    return true;
}

/* =========================================================
   🧠 VERIFY + UPDATE INVENTORY INTEGRITY + TRUST
========================================================= */
async function verifyAndUpdateInventoryIntegrity(inventoryId) {

    const ledgerValid = await verifySaleLedger(inventoryId);

    const inventory = await RetailerInventory.findOne({ inventoryId });
    if (!inventory) return;

    /* =====================================================
       🔍 CHECK INVENTORY VS LEDGER CONSISTENCY
    ===================================================== */
    const sales = await SaleLog
        .find({ inventoryId })
        .sort({ createdAt: 1 });

    let computedSold = 0;
    let computedRemaining = inventory.quantity;

    for (const sale of sales) {
        computedSold += sale.quantitySold;
        computedRemaining -= sale.quantitySold;
    }

    const tolerance = 0.01; // 🔥 allow minor diff (float safe)

    const soldMismatch =
        Math.abs(computedSold - inventory.soldQuantity) > tolerance;

    const remainingMismatch =
        Math.abs(computedRemaining - inventory.remainingQuantity) > tolerance;

    const isTampered = !ledgerValid;
    /* =====================================================
       🔥 INTEGRITY + TRUST UPDATE (CORE FIX)
    ===================================================== */

    // 👉 Only act when state changes (prevents duplicate penalties)
    if (isTampered && inventory.integrityStatus !== "TAMPERED") {

        inventory.integrityStatus = "TAMPERED";

        // ❌ INVALID BLOCK → trust decreases naturally
        await updateTrust(
            inventory.retailerId,       // roleId
            inventory.retailerId,       // entityName
            "RETAILER",
            false,                      // invalid block
            "Tampering detected in sale ledger",
            inventory.batchId
        );

    } else if (!isTampered && inventory.integrityStatus !== "AUTHENTIC") {

        inventory.integrityStatus = "AUTHENTIC";

        // ✅ VALID BLOCK → trust increases
        await updateTrust(
            inventory.retailerId,
            inventory.retailerId,
            "RETAILER",
            true,
            "Sale ledger verified successfully",
            inventory.batchId
        );
    }

    await inventory.save();

    return !isTampered;
}

/* =========================================================
   EXPORTS
========================================================= */
module.exports = {
    generateSaleHash,
    verifySaleLedger,
    verifyAndUpdateInventoryIntegrity
};
exports.calculateIntegrityScore = ({ isVerified = false, shipmentCount = 0 }) => {

  // ❌ If blockchain hash mismatch → immediate tampering
  if (!isVerified) {
    return {
      integrityScore: 0,
      integrityStatus: "TAMPERED"
    };
  }

  // ✅ Base trust from blockchain verification
  let score = 50;

  // 🚚 Transporter update
  if (shipmentCount >= 1) score += 25;

  // 🏪 Retailer / multi-handoff update
  if (shipmentCount >= 2) score += 25;

  return {
    integrityScore: Math.min(score, 100),
    integrityStatus: "VERIFIED"
  };
};

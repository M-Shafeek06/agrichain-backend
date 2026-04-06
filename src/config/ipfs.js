const { create } = require("ipfs-http-client");

// Infura public IPFS gateway
const ipfs = create({
  host: "ipfs.infura.io",
  port: 5001,
  protocol: "https"
});

module.exports = ipfs;

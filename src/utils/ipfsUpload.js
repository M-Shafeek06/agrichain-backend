const axios = require("axios");

const uploadToIPFS = async (data) => {
  try {
    const res = await axios.post(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      data,
      {
        headers: {
          pinata_api_key: process.env.PINATA_API_KEY,
          pinata_secret_api_key: process.env.PINATA_SECRET_KEY
        }
      }
    );

    return res.data.IpfsHash;
  } catch (error) {
    console.error("❌ Pinata Upload Failed:", error.response?.data || error.message);
    throw new Error("IPFS upload failed");
  }
};

module.exports = uploadToIPFS;

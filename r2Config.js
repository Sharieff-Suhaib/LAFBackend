const { S3Client } = require("@aws-sdk/client-s3");
const dotenv = require("dotenv");
dotenv.config();

const r2 = new S3Client({
  endpoint: process.env.ACCESS_ENDPOINT,
  region: "auto",
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.ACCESS_KEY,
  },
});

module.exports = r2;
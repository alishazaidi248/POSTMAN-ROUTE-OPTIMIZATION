require("dotenv").config();

const appJson = require("./app.json");

/** Layers .env values into Constants.expoConfig.extra (see src/config/env.ts). */
module.exports = ({ config }) => ({
  ...appJson.expo,
  ...config,
  extra: {
    ...config.extra,
    API_BASE_URL: process.env.API_BASE_URL,
    MAP_STYLE_URL: process.env.MAP_STYLE_URL,
    OSRM_BASE_URL: process.env.OSRM_BASE_URL
  }
});

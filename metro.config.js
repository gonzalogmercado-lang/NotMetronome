// eslint-disable-next-line import/no-extraneous-dependencies
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.assetExts = [...new Set([...config.resolver.assetExts, "wav", "mp3", "caf"])];

module.exports = config;

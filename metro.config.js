const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Ensure support for asset extensions
config.resolver.assetExts.push('srt', 'mp3', 'wav');

module.exports = config;

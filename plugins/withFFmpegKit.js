const { withProjectBuildGradle, createRunOncePlugin } = require('@expo/config-plugins');

/**
 * Expo Config Plugin for ffmpeg-kit-react-native
 * Injects ffmpegKitPackage = "full-gpl" into Android root build.gradle
 */
const withFFmpegKit = (config, props = {}) => {
  const packageName = props.package || 'full-gpl';

  return withProjectBuildGradle(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    if (!contents.includes('ffmpegKitPackage')) {
      if (contents.includes('ext {')) {
        contents = contents.replace(
          'ext {',
          `ext {\n        ffmpegKitPackage = "${packageName}"`
        );
      } else if (contents.includes('buildscript {')) {
        contents = contents.replace(
          'buildscript {',
          `buildscript {\n    ext {\n        ffmpegKitPackage = "${packageName}"\n    }`
        );
      }
      modConfig.modResults.contents = contents;
    }

    return modConfig;
  });
};

module.exports = createRunOncePlugin(
  withFFmpegKit,
  'ffmpeg-kit-react-native',
  '1.0.0'
);

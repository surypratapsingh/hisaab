const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Gradle output is gigabytes of files Metro never needs. Crawling it made
// Metro hang for minutes before serving the first bundle.
const nativeBuildOutput = [
  /[\\/]android[\\/](app[\\/])?build[\\/].*/,
  /[\\/]android[\\/]\.gradle[\\/].*/,
  /[\\/]android[\\/]app[\\/]\.cxx[\\/].*/,
  /[\\/]modules[\\/][^\\/]+[\\/]android[\\/]build[\\/].*/,
];
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  ...nativeBuildOutput,
];

module.exports = withNativeWind(config, { input: './global.css' });

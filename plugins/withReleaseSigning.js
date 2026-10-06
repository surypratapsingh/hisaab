// Signs the released app with the owner's own private key instead of the shared "Android Debug"
// key that every Expo project ships with (anyone holding that public key could build a
// look-alike app that Android would accept as an update to Money OS; see SECURITY.md).
//
// The key never enters the repo. Its location and passwords are read from Gradle properties,
// kept in the user's own ~/.gradle/gradle.properties (outside the project):
//
//   MONEYOS_UPLOAD_STORE_FILE=C:/Users/<you>/keys/money-os-release.jks
//   MONEYOS_UPLOAD_STORE_PASSWORD=...
//   MONEYOS_UPLOAD_KEY_ALIAS=money-os
//   MONEYOS_UPLOAD_KEY_PASSWORD=...
//
// Without them a release build still works for inspection, signed with the debug key, and
// Gradle prints a warning saying so. Such an APK must not be given to anyone.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// money-os: release signing';

const RELEASE_SIGNING_CONFIG = `        release { ${MARKER}
            if (findProperty('MONEYOS_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('MONEYOS_UPLOAD_STORE_FILE'))
                storePassword findProperty('MONEYOS_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('MONEYOS_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('MONEYOS_UPLOAD_KEY_PASSWORD')
            }
        }
`;

const RELEASE_SIGNING_CHOICE = `            if (findProperty('MONEYOS_UPLOAD_STORE_FILE')) {
                signingConfig signingConfigs.release
            } else {
                logger.warn('Money OS: MONEYOS_UPLOAD_STORE_FILE is not set, so this release build is signed with the public debug key. Do not give it to anyone.')
                signingConfig signingConfigs.debug
            }`;

// Exported so the same edit can be applied to an already generated android/ folder.
function addReleaseSigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;

  const configs = gradle.replace(/(\n    signingConfigs \{\n)/, `$1${RELEASE_SIGNING_CONFIG}`);
  const release = configs.replace(
    /(\n        release \{\n(?:            \/\/.*\n)*)            signingConfig signingConfigs\.debug/,
    `$1${RELEASE_SIGNING_CHOICE}`
  );
  if (configs === gradle || release === configs) {
    throw new Error('withReleaseSigning: app/build.gradle no longer has the expected signingConfigs / release blocks');
  }
  return release;
}

const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = addReleaseSigning(mod.modResults.contents);
    return mod;
  });

module.exports = withReleaseSigning;
module.exports.addReleaseSigning = addReleaseSigning;

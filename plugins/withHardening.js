// Security hardening for the released app. Applied when `npx expo prebuild` generates the
// Android project, so the rules live in the repo and not in a folder that gets regenerated.
//
//  - Released builds hold no network permission at all: with no INTERNET permission the
//    app cannot send anything anywhere, whatever any library inside it tries. This is what
//    backs the claim that nothing leaves the phone.
//  - No overlay permission (only the development menu needs it), no legacy storage
//    permissions (files are chosen with the system picker), and no cloud or adb backup of
//    the app's data, which holds the whole ledger.
//  - No `moneyos://` link that other apps or web pages could fire at the app.
//  - The app's window is marked secure in released builds: no screenshots or screen
//    recording of it, and a blank preview in the recent-apps list.
//
// Development builds keep what they need (Metro over the network, the dev menu, links) from
// src/debug/AndroidManifest.xml, and can still be screenshotted for testing.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withMainActivity, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

const TOOLS = 'http://schemas.android.com/tools';

const REMOVED_IN_RELEASE = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

const withReleaseManifest = (config) =>
  withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$['xmlns:tools'] = TOOLS;

    // A removal marker beats any library that declares the permission.
    const kept = (manifest['uses-permission'] ?? []).filter((p) => !REMOVED_IN_RELEASE.includes(p.$['android:name']));
    manifest['uses-permission'] = [
      ...kept,
      ...REMOVED_IN_RELEASE.map((name) => ({ $: { 'android:name': name, 'tools:node': 'remove' } })),
    ];

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$['android:allowBackup'] = 'false';
    application.$['android:usesCleartextTraffic'] = 'false';

    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    activity['intent-filter'] = (activity['intent-filter'] ?? []).filter(
      (filter) => !(filter.data ?? []).some((d) => d.$['android:scheme'] === 'moneyos')
    );
    return mod;
  });

const DEBUG_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <!-- Development builds only: Metro over the network, the developer menu, and the dev-client link. -->
    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>

    <application android:usesCleartextTraffic="true" tools:targetApi="28" tools:ignore="GoogleAppIndexingWarning" tools:replace="android:usesCleartextTraffic">
        <activity android:name=".MainActivity">
            <intent-filter>
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="moneyos"/>
            </intent-filter>
        </activity>
    </application>
</manifest>
`;

const withDebugManifest = (config) =>
  withDangerousMod(config, [
    'android',
    (mod) => {
      const folder = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'debug');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'AndroidManifest.xml'), DEBUG_MANIFEST);
      return mod;
    },
  ]);

const SECURE_WINDOW = `    // Released builds only: keep the app out of screenshots, screen recordings and the
    // recent-apps preview. Debug builds are left capturable so they can be tested.
    if (!BuildConfig.DEBUG) {
      window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    }
`;

const withSecureWindow = (config) =>
  withMainActivity(config, (mod) => {
    let source = mod.modResults.contents;
    if (source.includes('FLAG_SECURE')) return mod;

    if (!source.includes('import android.view.WindowManager')) {
      source = source.replace('import android.os.Bundle', 'import android.os.Bundle\nimport android.view.WindowManager');
    }
    // After super.onCreate, once there is a window to mark.
    source = source.replace(/(super\.onCreate\([^)]*\)\s*\n)/, `$1${SECURE_WINDOW}`);
    if (!source.includes('FLAG_SECURE')) {
      throw new Error('withHardening: could not find super.onCreate in MainActivity to mark the window secure');
    }
    mod.modResults.contents = source;
    return mod;
  });

module.exports = function withHardening(config) {
  return withSecureWindow(withDebugManifest(withReleaseManifest(config)));
};

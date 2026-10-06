// Launcher shortcuts: press and hold the Money OS icon and pick "Scan and pay", "Add purchase" or
// "Record a transaction" to land straight on the scanner or that form. Applied when
// `npx expo prebuild` generates the Android project.
//
// Each shortcut fires an explicit intent at MainActivity with an action of our own. Nothing
// here adds an intent filter, a link scheme or an exported component: the actions only ask the
// app to open the scanner or a blank form, which sit behind the app lock in a released build.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withStringsXml, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

const PACKAGE = 'com.surya.moneyos';

const SHORTCUTS = [
  { id: 'scan_pay', action: `${PACKAGE}.action.SCAN_PAY`, short: 'Scan and pay', long: 'Scan a UPI code and pay' },
  { id: 'add_purchase', action: `${PACKAGE}.action.ADD_PURCHASE`, short: 'Add purchase', long: 'Add a purchase' },
  { id: 'add_transaction', action: `${PACKAGE}.action.ADD_TRANSACTION`, short: 'Record a transaction', long: 'Record a transaction by hand' },
];

const shortcutsXml = () =>
  `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${SHORTCUTS.map(
  (s) => `    <shortcut
        android:shortcutId="${s.id}"
        android:enabled="true"
        android:shortcutShortLabel="@string/shortcut_${s.id}_short"
        android:shortcutLongLabel="@string/shortcut_${s.id}_long">
        <intent
            android:action="${s.action}"
            android:targetPackage="${PACKAGE}"
            android:targetClass="${PACKAGE}.MainActivity" />
    </shortcut>`
).join('\n')}
</shortcuts>
`;

const withShortcutMetaData = (config) =>
  withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    const meta = (activity['meta-data'] ?? []).filter((m) => m.$['android:name'] !== 'android.app.shortcuts');
    meta.push({ $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/shortcuts' } });
    activity['meta-data'] = meta;
    return mod;
  });

const withShortcutLabels = (config) =>
  withStringsXml(config, (mod) => {
    for (const s of SHORTCUTS) {
      mod.modResults = AndroidConfig.Strings.setStringItem(
        [{ $: { name: `shortcut_${s.id}_short` }, _: s.short }],
        mod.modResults
      );
      mod.modResults = AndroidConfig.Strings.setStringItem(
        [{ $: { name: `shortcut_${s.id}_long` }, _: s.long }],
        mod.modResults
      );
    }
    return mod;
  });

const withShortcutFile = (config) =>
  withDangerousMod(config, [
    'android',
    (mod) => {
      const folder = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'shortcuts.xml'), shortcutsXml());
      return mod;
    },
  ]);

module.exports = function withShortcuts(config) {
  return withShortcutFile(withShortcutLabels(withShortcutMetaData(config)));
};

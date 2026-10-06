// Lets other apps share files to Money OS: statements and CAS PDFs, CSV
// exports, and photos of bills. Adds SEND intent filters to MainActivity
// when `npx expo prebuild` generates the Android project.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

// JSON: a Paisa backup shared from a file manager.
// text/plain: a bill reminder shared as text from SMS, WhatsApp or email (read into a Recurring draft).
const MIME_TYPES = ['application/pdf', 'text/csv', 'text/comma-separated-values', 'application/json', 'image/*', 'text/plain'];

const sendFilter = (mimeType) => ({
  action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
  category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
  data: [{ $: { 'android:mimeType': mimeType } }],
});

module.exports = function withShareTarget(config) {
  return withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    const filters = activity['intent-filter'] ?? [];
    const already = new Set(
      filters.flatMap((f) =>
        (f.action ?? []).some((a) => a.$['android:name'] === 'android.intent.action.SEND')
          ? (f.data ?? []).map((d) => d.$['android:mimeType'])
          : []
      )
    );
    for (const mimeType of MIME_TYPES) {
      if (!already.has(mimeType)) filters.push(sendFilter(mimeType));
    }
    activity['intent-filter'] = filters;
    return mod;
  });
};

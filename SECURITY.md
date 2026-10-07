# Security — what has been checked, and what has not

Money OS holds a real ledger: bank and UPI activity, balances, what was bought. This file
records what was actually verified (and how, so it can be repeated), and what is still open.
It is the source for any claim the app makes about safety. Last reviewed 2026-09-27 (again after launcher shortcuts, the camera button, the listener allow-list, and Scan and pay).

**Who it defends against:** someone holding the phone; another app on the phone; a malicious
or compromised package (dependency or build tool); someone with a USB cable; a tampered backup
or shared file.

## Verified

| Claim | How it was checked |
|---|---|
| **Nothing leaves the phone.** | The released app holds no INTERNET permission, so no code inside it can send anything. Read from the merged release manifest (`android/app/build/intermediates/merged_manifest/release/…`). The app's own code contains no `fetch`, `XMLHttpRequest`, `WebSocket`, `eval` or dynamic code (`grep` over `src/`); the one link, to MF Central, opens the browser only when tapped. Over-the-air updates are off (`expo.modules.updates.ENABLED=false`). |
| **The released app cannot be debugged or backed up.** | Merged release manifest: no `android:debuggable`, `allowBackup="false"`, `usesCleartextTraffic="false"`. |
| **No overlay, legacy storage or link-in.** | Release manifest holds only `USE_BIOMETRIC`, `USE_FINGERPRINT`, `VIBRATE`, `READ_SMS` (see open items). No `SYSTEM_ALERT_WINDOW`, no storage permissions, no `moneyos://` link. Development builds get the extras from `src/debug/AndroidManifest.xml`, written by `plugins/withHardening.js`. |
| **Screenshots and the recent-apps preview are blocked in the released app.** | `plugins/withHardening.js` marks the window `FLAG_SECURE` when `!BuildConfig.DEBUG`. Development builds stay capturable so they can be tested. Seen on the emulator 2026-10-06 (release build, API 36): a screenshot of the app is black. *Not yet seen on a real phone.* |
| **The lock cannot be switched off in a released app.** | The development-only switch is `src/security/devLock.ts`. In a production bundle it compiles to `var LOCK_OFF_FOR_DEVELOPMENT = false` (checked by exporting a production bundle without minifying and reading it). There is no setting, stored value, intent or link that turns the lock off. |
| **What other apps can reach.** | Exported components (merged manifest): `MainActivity` (launcher, the share target and the three launcher shortcuts), the notification listener (only the system may bind it: `BIND_NOTIFICATION_LISTENER_SERVICE`), a home-screen widget receiver (`QuickWidget`, 2026-09-27; it only draws two buttons that open the same form or scanner, and shows no amounts), two Quick Settings tiles added 2026-09-27 (`ScanPayTile`, `AddPurchaseTile`; only the system may bind them: `BIND_QUICK_SETTINGS_TILE`; they open the same blank form or scanner as the shortcuts, after the phone's own unlock when locked), and androidx's profile-install receiver (only the system's DUMP permission may use it). All three were read from the merged release manifest, along with the fact that no provider is exported and no component leaves the flag unset. The one provider (`CaptureFileProvider`, for the camera's picture) is `exported="false"` and serves only the private `cache/captures` folder. The three shortcut actions (`com.surya.moneyos.action.ADD_PURCHASE`, `…ADD_TRANSACTION`, `…SCAN_PAY`) can be sent by any app and only open a blank form or the scanner. The code scanner's own delegate activity (`GmsBarcodeScanningDelegateActivity`, from `play-services-code-scanner`) is `exported="false"`. |
| **The camera needs no permission of ours.** | "Take photo" asks the phone's own camera app for one picture (`ACTION_IMAGE_CAPTURE`); Money OS declares no `CAMERA` permission and holds no camera code. |
| **Scan and pay cannot move money, or be steered to another payee.** | Money OS holds no payment credential and no UPI code. It scans with Google Play services' own code scanner (no `CAMERA` permission of ours; the library's manifest adds one unexported activity and no permission, read from the library and from the merged debug manifest), shows the payee, and hands the phone's UPI apps a link it builds itself (`openUpi` refuses anything that does not start `upi://pay?`; the system chooser lists the apps). Only `upi://pay` codes are read: `collect` and `mandate` codes are refused, a code that repeats a field (which two apps could read two ways) is refused, and the link is rebuilt from the fields understood, so a name like `Shop&pa=other@bank` cannot add a second payee (`src/upi/link.test.ts`). The UPI app's own answer is only a note: a payment is counted when the bank's message arrives or the payer says so (`src/upi/session.test.ts`). Payee UPI addresses are kept in the settings table, as unprotected as the rest of the database until the encryption decision below. *Compiled; not yet run on a phone.* |
| **Other people's conversations are not read.** | The notification listener ignores every app except messages, UPI and bank apps (`FINANCIAL_APPS` in `AlertListenerService.kt`) before reading the text. WhatsApp, Telegram, Instagram and the like are never captured. Fails closed: a bank app missing from the list is not read until added. |
| **A file shared from another app cannot be used without a yes.** | `handleFile(…, { shared: true })` asks first, and names the file; a share is accepted only with a `content://` address, and a file larger than 25 MB is refused instead of loaded (`IntakeModule.kt`). |
| **Backups are encrypted, and cannot be turned against the app.** | scrypt (N=2^15) + AES-256-GCM, header authenticated (`src/security/encryption.ts`); a restore goes only into an empty ledger; product photos are neither written into a backup nor read from one (a tampered file cannot point the app at an address or another app's file: test in `security.test.ts`). |
| **No known-malicious or altered packages.** | `npm audit signatures` (re-run 2026-09-27 after the vitest 5 upgrade): 581 installed packages have verified registry signatures, 153 also have provenance attestations. `package-lock.json`: all 676 entries come from `registry.npmjs.org` with an integrity hash; none from git, a tarball URL or another host. Only two packages run code when installed: `esbuild` (a development tool) and `fsevents` (macOS only). |
| **Known vulnerabilities.** | `npm audit`: 10 moderate advisories, **none in code that ships in the app**. All are in Expo's prebuild config tools. The vitest / vite / esbuild ones (including the critical one) were cleared by upgrading to vitest 5 on 2026-09-27. Details in the table below. |
| **Delete all data really deletes.** | It wipes the database and the product photo folder (`discardAllProductPhotos`). |
| **Nothing sensitive in the phone's log.** | The only `console.*` call left in the app logs the words "SMS read failed", not the error or a message. No native `Log.` calls. |

### npm audit, 2026-09-27 (all development tooling)

- ~~`vitest` ≤ 1.x (critical) and `vite`, `vite-node`, `esbuild`~~: fixed 2026-09-27 by vitest 5.0.2 + vite 8.3.1
  (and `@types/node` 24, which vitest 5 needs; tsconfig now lists `"types": ["node"]`).
- `expo`, `@expo/cli`, `@expo/config`, `@expo/config-plugins`, `@expo/prebuild-config`,
  `@expo/metro-config`, `@expo/inline-modules`, `@expo/local-build-cache-provider`, `xcode`, `uuid`
  (moderate): a `uuid` buffer-bounds issue reached through Expo's iOS project tools at build time.
  npm's suggested "fix" is to downgrade Expo to version 46, which is wrong and was not taken.

## Open — before the app is distributed

1. **The APK on the phone is a development build.** It is debuggable and signed with the shared
   debug key, so anyone with USB debugging enabled on that phone can read the whole database
   (`adb … run-as com.surya.moneyos` does exactly that). A released build is not debuggable.
   The release build was built and inspected on 2026-09-27 (52 MB; no INTERNET, not debuggable,
   backup off), but it is still **signed with the standard "Android Debug" key** (SHA-256 `fac61745…3b9c`),
   which is the same in every Expo project and public: anyone could build a look-alike app signed
   with it that Android would accept as an update to Money OS. A private key is what stops that.
   Needs: a keystore made and kept by the owner (outside the repo, with a backup of the file and its
   password), a release build signed with it, and a fresh install.
   **The build side is ready (2026-09-27):** `plugins/withReleaseSigning.js` (also applied to the
   current `android/app/build.gradle`) signs release builds with the key named by four Gradle
   properties kept in `~/.gradle/gradle.properties`, never in the repo:
   `MONEYOS_UPLOAD_STORE_FILE`, `MONEYOS_UPLOAD_STORE_PASSWORD`, `MONEYOS_UPLOAD_KEY_ALIAS`,
   `MONEYOS_UPLOAD_KEY_PASSWORD`. Without them the release build is still signed with the debug key
   and Gradle warns. The owner makes the key (it is their private key):
   `keytool -genkeypair -v -storetype PKCS12 -keystore money-os-release.jks -alias money-os -keyalg RSA -keysize 4096 -validity 10000`.
   Build for the phone with `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`
   (`JAVA_HOME` = Android Studio's `jbr`, `ANDROID_HOME` = the SDK). That APK is 60 MB; without the flag it
   carries four CPU types and is 158 MB (2026-10-06). Raise `versionCode` in app.json and
   `android/app/build.gradle` for every build given out after the first.
   Then check the APK: `apksigner verify --print-certs app-release.apk` must not show `fac61745…`.
   Not yet compiled with a real key. Because the signature changes,
   Android will not update in place. Safe order: (1) take an encrypted backup in the app (with the
   code from 2026-10-07 on, backup version 9, so each entry keeps the message or statement it came
   from; an older backup restores the money but not those links) and check
   the file opens on the Restore screen's passphrase step; (2) build the release APK with the new
   key; (3) uninstall the development app; (4) install the release APK; (5) Restore from the backup
   (product photos are not in backups and would have to be added again).
2. **The database is not encrypted at rest.** It sits in the app's private folder, protected by
   Android's app sandbox and the phone's own encryption, but readable with root or a debuggable
   build. SQLCipher (supported by op-sqlite) with a key held in the Android Keystore would fix it;
   that needs a new dependency and a rebuild, so it has not been started without a yes.
   **Approved (2026-09-27); built, not yet compiled or run on a phone.** `package.json` sets
   `"op-sqlite": { "sqlcipher": true }` (adds `io.github.ronickg:openssl` at build time). The key is 32
   random bytes in the Android Keystore through `expo-secure-store` (its backup rules are off; app backup
   is off anyway). `src/db/atRest.ts` opens `money-enc.db` with it and, once, copies an existing
   `money.db` into it with `sqlcipher_export`, counts every table against the old file, records the
   move, and only then deletes the old file; a copy that does not match is thrown away and the old
   file keeps working. Take an encrypted backup before installing the first build with it.
   **Checked on the phone 2026-10-06:** the first 16 bytes of `databases/money-enc.db` are random, not
   `SQLite format 3`, so the ledger is encrypted. A plaintext copy made by hand as a safety copy before the move
   (`databases/money.db.premigration`, not made by the app) must be deleted:
   `adb shell run-as com.surya.moneyos rm databases/money.db.premigration`. Exports (CSV, reports) and
   any backup file from another app are plain files outside the app, readable by any app with file access.
3. **The lock is off in development builds.** Re-enable by deleting `src/security/devLock.ts` and
   its use in `App.tsx` (or setting `KEEP_LOCK_IN_DEV = true` to try the real lock), then test the
   fingerprint and PIN fallback on the phone. The unlock logic in `src/security/applock.ts`
   already refuses a replayed success and clears a stale prompt.
4. **`READ_SMS`** is in the sideloaded build (decisions.md, 2026-09-26). It cannot be published on
   Google Play, and it is the most sensitive permission the app holds. Decide whether the shipped
   build keeps it or relies on notification access alone. **Decided 2026-09-27: keep it while the app
   is sideloaded** (history backfill, and bank texts the notification reader misses).
5. **The released build has not been run on a phone.** `FLAG_SECURE`, the merged manifest and code
   shrinking (R8, off for now) are verified by build and by reading output, not by use.
   **Run on the emulator 2026-10-06** (version 1.0.0, made-up data, installed over the development
   build): it opens the same encrypted ledger, the screenshot is black, `run-as` is refused ("package
   not debuggable"), the lock runs at start (the emulator has no screen lock, so it says so and opens),
   and Home, Activity, Reports and More open with no crash. Not tried: the fingerprint and PIN prompt
   itself, and anything on a real phone.
6. ~~**Backup passphrase minimum is 8 characters.**~~ Raised to 12 on 2026-09-27 for new backups;
   backups made earlier with a shorter passphrase still open.
7. **Product photos are stored unencrypted** in the app's private folder, and are not part of a
   backup (they do not travel to a new phone).
8. ~~**Upgrade vitest**~~ Done 2026-09-27 (vitest 5, threads, at most 4 workers). Keep re-running
   `npm audit` and `npm audit signatures` after any dependency change.

## Repeating the checks

```
npm audit
npm audit signatures
cd android && ./gradlew processDebugMainManifest processReleaseMainManifest   # then read the two merged manifests
npx expo export --platform android --no-bytecode --no-minify --output-dir <dir>  # then search for LOCK_OFF_FOR_DEVELOPMENT
```

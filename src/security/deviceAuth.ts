import * as LocalAuthentication from 'expo-local-authentication';
import { runCheck, type Authenticator } from './applock';

/** The real phone. Kept out of the index so tests never load native code. */
export const deviceAuthenticator: Authenticator = {
  async security() {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level === LocalAuthentication.SecurityLevel.NONE ? 'unsecured' : 'secured';
  },
  authenticate(prompt) {
    return runCheck(
      () =>
        LocalAuthentication.authenticateAsync({
          promptMessage: prompt,
          // Fall back to the phone's PIN, pattern or password.
          disableDeviceFallback: false,
          cancelLabel: 'Cancel',
        }),
      LocalAuthentication.cancelAuthenticate
    );
  },
};

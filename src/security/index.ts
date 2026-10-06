export type { Authenticator, DeviceSecurity, LockState, UnlockOutcome } from './applock';
export {
  RELOCK_AFTER_MS,
  initialLockState,
  onBackground,
  onForeground,
  unlock,
} from './applock';

export type { ExportFormat, Backup, BackupMetadata, BackupError } from './backup';
export {
  exportLedger,
  importBackup,
  deleteAllData,
  checksum,
  BACKUP_VERSION,
  DELETE_CONFIRMATION,
  sealBackup,
  openBackup,
} from './backup';

export type { EncryptionError, RandomSource, KdfParams } from './encryption';
export {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  MIN_PASSPHRASE_LENGTH,
} from './encryption';

package expo.modules.intake

import androidx.core.content.FileProvider

/**
 * Its own subclass, so the manifest merger never mistakes it for another library's
 * FileProvider. Serves only the cache/captures folder (see res/xml/intake_capture_paths.xml).
 */
class CaptureFileProvider : FileProvider()

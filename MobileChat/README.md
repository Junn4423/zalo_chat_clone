# MobileChat Android source

This folder contains the complete React Native mobile client. It is configured to use the public MobileChat API at `login.sof.com.vn/mobilechat-api`.

## Requirements

- Node.js 18 or newer
- JDK 17
- Android Studio with Android SDK 35 and NDK 27.1.12297006
- Android device or emulator with USB debugging enabled

## Build and install for QA

From this folder, install the locked JavaScript dependencies, then build and install the self-contained release variant:

```powershell
npm ci
cd android
gradlew.bat assembleRelease
adb install -r app\build\outputs\apk\release\app-release.apk
```

The release variant uses the local debug signing key when no release signing configuration is present. It can be installed for internal QA; Google Play or production distribution requires your organization's release key.

## Production signing

Create `android/keystore.properties` locally with these values:

```properties
MYAPP_RELEASE_STORE_FILE=path/to/release-key.keystore
MYAPP_RELEASE_STORE_PASSWORD=your-store-password
MYAPP_RELEASE_KEY_ALIAS=your-key-alias
MYAPP_RELEASE_KEY_PASSWORD=your-key-password
```

Then run `gradlew.bat assembleRelease` again. Keep this file and the signing key private; they are excluded from the source package.

## iOS

On macOS, run `npm ci`, install CocoaPods in `ios`, and open `ios/MobileChat.xcworkspace` in Xcode. Camera permission is configured for the QR scanner.

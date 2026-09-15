#!/usr/bin/env python3
"""Configure a freshly generated Tauri Android Gradle project for CI release signing."""
from pathlib import Path
import os

root = Path(__file__).resolve().parents[1]
gradle = root / 'src-tauri/gen/android/app/build.gradle.kts'
properties = root / 'src-tauri/gen/android/keystore.properties'
for name in ('ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_KEY_BASE64'):
    if not os.environ.get(name):
        raise SystemExit(f'Missing GitHub Actions secret: {name}')
if not gradle.is_file():
    raise SystemExit('Run tauri android init before configuring signing')
keystore = Path(os.environ['RUNNER_TEMP']) / 'radish-phone-release.jks'
import base64
keystore.write_bytes(base64.b64decode(os.environ['ANDROID_KEY_BASE64'], validate=True))
properties.write_text(
    f"keyAlias={os.environ['ANDROID_KEY_ALIAS']}\n"
    f"password={os.environ['ANDROID_KEY_PASSWORD']}\n"
    f"storeFile={keystore}\n"
)
text = gradle.read_text()
if 'import java.io.FileInputStream' not in text:
    text = 'import java.io.FileInputStream\n' + text
anchor = '    buildTypes {'
if anchor not in text:
    raise SystemExit('Tauri Android Gradle template has changed: buildTypes block missing')
if 'create("release")' not in text:
    signing = '''    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["password"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["password"] as String
        }
    }
'''
    text = text.replace(anchor, signing + anchor, 1)
if 'signingConfig = signingConfigs.getByName("release")' not in text:
    text = text.replace(anchor, anchor + '\n        getByName("release") { signingConfig = signingConfigs.getByName("release") }', 1)
gradle.write_text(text)
print('Android release signing configured')

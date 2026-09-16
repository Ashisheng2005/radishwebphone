#!/usr/bin/env python3
"""Configure a freshly generated Tauri Android Gradle project for CI release signing."""
from pathlib import Path
import os
import subprocess

root = Path(__file__).resolve().parents[1]
gradle = root / 'src-tauri/gen/android/app/build.gradle.kts'
properties = root / 'src-tauri/gen/android/keystore.properties'


def fail(message: str) -> None:
    print(f'::error title=Android signing configuration::{message}')
    raise SystemExit(1)


required = ('ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_KEY_BASE64')
missing = [name for name in required if not os.environ.get(name)]
if missing:
    fail(f'Missing GitHub Actions secret(s): {", ".join(missing)}')
if not gradle.is_file():
    fail(f'Android Gradle file was not generated: {gradle}')
keystore = Path(os.environ['RUNNER_TEMP']) / 'radish-phone-release.jks'
import base64
try:
    encoded_key = ''.join(os.environ['ANDROID_KEY_BASE64'].split())
    decoded_key = base64.b64decode(encoded_key, validate=True)
except (ValueError, base64.binascii.Error) as error:
    fail(f'ANDROID_KEY_BASE64 is not valid base64 ({type(error).__name__})')
if decoded_key[:4] != bytes.fromhex('feedfeed'):
    fail('ANDROID_KEY_BASE64 does not contain a JKS keystore')
keystore.write_bytes(decoded_key)
key_check = subprocess.run(
    [
        'keytool', '-list',
        '-keystore', str(keystore),
        '-storepass', os.environ['ANDROID_KEY_PASSWORD'],
        '-alias', os.environ['ANDROID_KEY_ALIAS'],
    ],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
if key_check.returncode != 0:
    fail('JKS password or key alias does not match the configured keystore')
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
    fail('Tauri Android Gradle template has changed: buildTypes block missing')
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
print(f'Android release signing configured with {len(decoded_key)}-byte JKS')

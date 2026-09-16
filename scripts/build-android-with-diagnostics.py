#!/usr/bin/env python3
"""Run the Android build and expose the useful Gradle failure as an Actions annotation."""

from collections import deque
import re
import subprocess


command = ['npm', 'exec', 'tauri', 'android', 'build', '--', '--apk', '--target', 'aarch64']
process = subprocess.Popen(
    command,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    errors='replace',
)
recent: deque[str] = deque(maxlen=160)
assert process.stdout is not None
for line in process.stdout:
    print(line, end='', flush=True)
    recent.append(line.rstrip())

exit_code = process.wait()
if exit_code:
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    lines = [ansi.sub('', line).strip() for line in recent if line.strip()]
    start = next((index for index, line in reversed(list(enumerate(lines))) if 'FAILURE: Build failed' in line), None)
    useful = lines[start:] if start is not None else lines[-35:]
    detail = ' | '.join(useful[-40:])[:7500]
    detail = detail.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f'::error title=Android Gradle build failed::{detail}')
    raise SystemExit(exit_code)

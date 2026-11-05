#!/usr/bin/env bash
# On the emulator: install, open, create a journal, write an entry, screenshot each step.
set -x
mkdir -p smoke
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb logcat -c
adb shell am start -n com.chrisgribble.wellwrite/.MainActivity
sleep 25
adb exec-out screencap -p > smoke/1-open.png
# The page can be driven through Chrome's remote debugging (debug builds only).
npm i --prefix /tmp/pw --silent playwright-core@1.56.1 >/dev/null 2>&1
NODE_PATH=/tmp/pw/node_modules node android/scripts/drive.js > smoke/drive.log 2>&1 || echo "drive failed"
# Real taps, with the on-screen keyboard as on a phone.
adb shell settings put secure show_ime_with_hard_keyboard 1
NODE_PATH=/tmp/pw/node_modules node android/scripts/taps.js > smoke/taps.log 2>&1 || echo "taps failed"
adb exec-out screencap -p > smoke/9-end.png
adb logcat -d > smoke/logcat.txt
grep -E "NODEJS|WellWrite|chromium|AndroidRuntime" smoke/logcat.txt | tail -200 > smoke/logcat-short.txt
true

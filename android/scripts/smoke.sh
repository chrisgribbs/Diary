#!/usr/bin/env bash
# On the emulator: install, open, create a journal, write an entry, screenshot each step.
set -x
mkdir -p smoke
# The emulator's own "isn't responding" pop-ups (the launcher, on a slow machine) would cover the app.
adb shell settings put global hide_error_dialogs 1
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb logcat -c
adb shell am start -n com.chrisgribble.wellwrite/.MainActivity
sleep 25
adb exec-out screencap -p > smoke/1-open.png
# The page can be driven through Chrome's remote debugging (debug builds only).
npm i --prefix /tmp/pw --silent playwright-core@1.56.1 >/dev/null 2>&1
drive_ok=1
NODE_PATH=/tmp/pw/node_modules node android/scripts/drive.js > smoke/drive.log 2>&1 || { echo "drive failed"; drive_ok=0; }
# Real taps, with the on-screen keyboard as on a phone.
adb shell settings put secure show_ime_with_hard_keyboard 1
taps_ok=1
NODE_PATH=/tmp/pw/node_modules node android/scripts/taps.js > smoke/taps.log 2>&1 || { echo "taps failed"; taps_ok=0; }
adb exec-out screencap -p > smoke/9-end.png
adb logcat -d > smoke/logcat.txt
grep -E "NODEJS|nodejs|WellWrite|chromium|AndroidRuntime" smoke/logcat.txt | tail -200 > smoke/logcat-short.txt
# The verdict. WellWrite opening and writing an entry (drive.js), and no crash, are required: a release waits for
# them (release.yml). The finger-tap checks only warn, as the emulator can be slow and flaky with them.
set +x
crashed=0
# WellWrite's own process dying, or its engine failing to start (only WellWrite's: other apps on the emulator can crash too).
if grep -qE "Fatal signal .*\(ibble\.wellwrite\)|Process: com\.chrisgribble\.wellwrite, PID" smoke/logcat.txt; then crashed=1; fi
if grep -qE "WellWrite engine: could not start| E nodejs  : (SyntaxError|ReferenceError)" smoke/logcat.txt; then crashed=1; fi
if [ "$crashed" = 1 ]; then echo "::error title=WellWrite crashed on the emulator::$(grep -E 'E nodejs|Fatal signal|FATAL EXCEPTION' smoke/logcat.txt | head -8 | tr '\n' ' ' | cut -c1-900)"; fi
if [ "$drive_ok" = 0 ]; then echo "::error title=WellWrite didn't open on the emulator::$(tail -5 smoke/drive.log | tr '\n' ' ' | cut -c1-500)"; fi
if [ "$taps_ok" = 0 ]; then echo "::warning title=Some finger-tap checks failed::$(grep -E 'FAIL|ERROR' smoke/taps.log | head -5 | tr '\n' ' ' | cut -c1-500)"; fi
[ "$drive_ok" = 1 ] && [ "$crashed" = 0 ]

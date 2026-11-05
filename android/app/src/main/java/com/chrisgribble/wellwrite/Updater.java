package com.chrisgribble.wellwrite;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;

/**
 * New versions of WellWrite: downloaded by the app itself (by themselves on Wi-Fi), checked to be WellWrite signed
 * with the same key, then handed to Android's own "Update" prompt. Nothing to find on a web page.
 */
final class Updater {
    interface Progress { void send(String json); }

    private static final String RELEASES = "https://github.com/chrisgribbs/Diary/releases/download/";
    private final Activity activity;
    private final Progress progress;
    private volatile Thread downloading;
    private volatile String readyVersion;
    private String pendingInstall;   // waiting for "Allow from this source"
    private volatile boolean asked;      // you tapped Update: show progress, install when downloaded
    private volatile Runnable whenDone;

    Updater(Activity activity, Progress progress) {
        this.activity = activity;
        this.progress = progress;
        // Old downloads, once they're installed.
        File[] old = dir().listFiles();
        if (old != null) for (File f : old) if (!f.getName().equals(fileFor(currentVersion()).getName())) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    private File dir() { File d = new File(activity.getCacheDir(), "updates"); //noinspection ResultOfMethodCallIgnored
        d.mkdirs(); return d; }
    private File fileFor(String version) { return new File(dir(), "WellWrite-" + version.replaceAll("[^0-9.]", "") + ".apk"); }
    private String currentVersion() {
        try { return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
    }

    /** Download (auto: only on Wi-Fi or other unmetered networks). Resolves when downloaded, or straight away if not now. */
    synchronized String download(String url, String version, boolean auto, Runnable done) {
        if (!url.startsWith(RELEASES) || !version.matches("[0-9]+\\.[0-9]+\\.[0-9]+")) return "Not a WellWrite release";
        if (version.equals(readyVersion) && fileFor(version).isFile()) { done.run(); return null; }
        if (auto) {
            ConnectivityManager cm = (ConnectivityManager) activity.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null || cm.isActiveNetworkMetered()) return null;   // on mobile data: wait until you tap Update
        }
        if (!auto) { asked = true; whenDone = done; }
        if (downloading != null) return null;   // already on its way; installs when it arrives if you asked
        final Runnable first = done;
        downloading = new Thread(() -> {
            File part = new File(dir(), "download.part");
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(30000);
                c.setRequestProperty("User-Agent", "WellWrite-Android");
                if (c.getResponseCode() != 200) throw new Exception("The update isn’t available yet (" + c.getResponseCode() + ")");
                long total = c.getContentLengthLong(), got = 0;
                int last = -1;
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        got += n;
                        int pct = total > 0 ? (int) (got * 100 / total) : 0;
                        if (pct != last && asked) { last = pct; progress.send("{\"downloading\":true,\"progress\":" + (pct / 100.0) + "}"); }
                    }
                }
                checkPackage(part, version);
                File apk = fileFor(version);
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
                if (!part.renameTo(apk)) throw new Exception("Couldn’t keep the download");
                readyVersion = version;
                progress.send("{\"ready\":true}");
                Runnable then = asked ? whenDone : first;
                asked = false; whenDone = null;
                if (then != null) activity.runOnUiThread(then);
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                if (asked) progress.send("{\"error\":" + org.json.JSONObject.quote("Couldn’t download the update: " + e.getMessage()) + "}");
            } finally {
                downloading = null;
                asked = false;
            }
        }, "WellWrite update");
        downloading.start();
        return null;
    }

    /** It must be WellWrite, the version we expect, signed with the same key as this copy. */
    private void checkPackage(File apk, String version) throws Exception {
        PackageManager pm = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo theirs = pm.getPackageArchiveInfo(apk.getPath(), flags);
        PackageInfo ours = pm.getPackageInfo(activity.getPackageName(), flags);
        if (theirs == null || !activity.getPackageName().equals(theirs.packageName)) throw new Exception("that file isn’t WellWrite");
        if (!version.equals(theirs.versionName)) throw new Exception("unexpected version " + theirs.versionName);
        if (!Arrays.equals(signatures(theirs), signatures(ours))) throw new Exception("it isn’t signed by WellWrite");
    }

    @SuppressWarnings("deprecation")
    private static Signature[] signatures(PackageInfo p) {
        if (Build.VERSION.SDK_INT >= 28 && p.signingInfo != null)
            return p.signingInfo.hasMultipleSigners() ? p.signingInfo.getApkContentsSigners() : p.signingInfo.getSigningCertificateHistory();
        return p.signatures;
    }

    /** Download if needed, then Android's "Do you want to update this app?" */
    void install(String url, String version) {
        String err = download(url, version, false, () -> launch(version));
        if (err != null) progress.send("{\"error\":" + org.json.JSONObject.quote(err) + "}");
    }

    private void launch(String version) {
        if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
            // Once only: Android asks you to allow WellWrite to install its own updates.
            pendingInstall = version;
            progress.send("{\"permission\":true}");
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
            return;
        }
        File apk = fileFor(version);
        if (!apk.isFile()) return;
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", apk);
        Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        progress.send("{\"installing\":true}");
        activity.startActivity(i);
    }

    /** Back from "Allow from this source". */
    void onResume() {
        String v = pendingInstall;
        if (v == null) return;
        pendingInstall = null;
        if (Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls()) launch(v);
        else progress.send("{\"error\":\"To update, allow WellWrite to install apps, then tap Update now again.\"}");
    }
}

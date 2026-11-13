package com.chrisgribble.wellwrite;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.activity.ComponentActivity;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Locale;
import java.util.Collections;
import java.util.List;

/**
 * The WellWrite window: the same page as the Windows app, shown in a WebView from the app's own files.
 * Messages (see renderer/android.js):
 *   page → here:  "H" hello · "E"+json for the engine · "N"+json for this app (save a file, open a link, go back)
 *   here → page:  "P"+json from the engine · "R"+json replies from this app · "B" the back button
 *   engine → here: "P"+json for the page · "N"+json to open a link · "Y" ready
 */
public class MainActivity extends ComponentActivity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final String START = ORIGIN + "/assets/www/index.html";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private WebView web;
    private FrameLayout root;
    private Updater updater;
    private JavaScriptReplyProxy page;
    private final List<String> toPage = new ArrayList<>();

    private ValueCallback<Uri[]> chooserCallback;
    private ActivityResultLauncher<Intent> chooser;
    private ActivityResultLauncher<Intent> saver;
    private ActivityResultLauncher<Intent> camera;
    private File cameraFile;
    private ActivityResultLauncher<String> notifyPermission;
    private JSONObject pendingPermission;
    private JSONObject pendingSave;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        EdgeToEdge.enable(this);
        super.onCreate(saved);
        NodeBridge.start(this);
        updater = new Updater(this, json -> post("U" + ascii(json)));
        if (saved == null) clearCameraCache(getCacheDir());

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#1d2a47"));
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView t = new TextView(this);
            t.setTextColor(Color.WHITE);
            t.setPadding(48, 160, 48, 48);
            t.setText("WellWrite needs a newer Android System WebView. Update “Android System WebView” in the Play Store, then open WellWrite again.");
            root.addView(t);
            setContentView(root);
            return;
        }

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#1d2a47"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        // Keep the page clear of the status bar, navigation bar and keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets b = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(b.left, b.top, b.right, b.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return assets.shouldInterceptRequest(req.getUrl());
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                openUrl(u.toString());   // web links open in the browser
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (chooserCallback != null) chooserCallback.onReceiveValue(null);
                chooserCallback = cb;
                boolean images = false;
                for (String a : params.getAcceptTypes()) if (a != null && a.startsWith("image/")) images = true;
                boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
                // The camera button: straight to the camera.
                if (images && params.isCaptureEnabled() && takePhoto()) return true;
                Intent i;
                if (images && Build.VERSION.SDK_INT >= 33) {
                    // Android's photo picker: your photos, newest first, no permission needed.
                    i = new Intent(MediaStore.ACTION_PICK_IMAGES);
                    i.setType("image/*");
                    if (multiple) i.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, Math.min(50, MediaStore.getPickImagesMaxLimit()));
                } else {
                    i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(images ? "image/*" : "*/*");
                    if (multiple) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try { chooser.launch(i); } catch (ActivityNotFoundException e) { chooserCallback = null; cb.onReceiveValue(null); }
                return true;
            }
        });

        chooser = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
            ValueCallback<Uri[]> cb = chooserCallback;
            chooserCallback = null;
            if (cb == null) return;
            Intent data = r.getData();
            if (r.getResultCode() != Activity.RESULT_OK || data == null) { cb.onReceiveValue(null); return; }
            List<Uri> uris = new ArrayList<>();
            ClipData clip = data.getClipData();
            if (clip != null) for (int k = 0; k < clip.getItemCount(); k++) uris.add(clip.getItemAt(k).getUri());
            else if (data.getData() != null) uris.add(data.getData());
            cb.onReceiveValue(uris.isEmpty() ? null : uris.toArray(new Uri[0]));
        });
        camera = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
            ValueCallback<Uri[]> cb = chooserCallback;
            chooserCallback = null;
            File f = cameraFile;
            cameraFile = null;
            if (cb == null) return;
            if (r.getResultCode() == Activity.RESULT_OK && f != null && f.length() > 0)
                cb.onReceiveValue(new Uri[] { FileProvider.getUriForFile(this, getPackageName() + ".files", f) });
            else cb.onReceiveValue(null);
        });
        notifyPermission = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            JSONObject req = pendingPermission; pendingPermission = null;
            if (req != null) reply(req, true, granted, null);
        });
        saver = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
            JSONObject req = pendingSave;
            pendingSave = null;
            if (req == null) return;
            Intent data = r.getData();
            if (r.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) { reply(req, true, null, null); return; }
            new Thread(() -> {
                File f = new File(req.optString("path"));
                try (InputStream in = new FileInputStream(f); OutputStream out = getContentResolver().openOutputStream(data.getData(), "wt")) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                    reply(req, true, req.optString("name"), null);
                } catch (Exception e) {
                    reply(req, false, null, "Couldn’t save the file there");
                }
            }).start();
        });

        WebViewCompat.addWebMessageListener(web, "WellWriteNative", Collections.singleton(ORIGIN),
                (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                    if (!isMainFrame) return;
                    String m = message.getData();
                    if (m == null || m.isEmpty()) return;
                    page = replyProxy;
                    switch (m.charAt(0)) {
                        case 'H': flushToPage(); break;
                        case 'E': NodeBridge.send(m.substring(1)); break;
                        case 'N': appRequest(m.substring(1)); break;
                        default: break;
                    }
                });
        NodeBridge.setListener(this::fromEngine);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { post("B"); }
        });

        web.loadUrl(START);
        prayerFrom(getIntent());
    }

    // ---------- messages ----------
    private void fromEngine(String m) {
        if (m.isEmpty()) return;
        char kind = m.charAt(0);
        if (kind == 'P') post(m);
        else if (kind == 'N') {
            try {
                JSONObject o = new JSONObject(m.substring(1));
                String op = o.optString("op");
                if ("openUrl".equals(op)) ui.post(() -> openUrl(o.optString("url")));
                else if ("keepRunning".equals(op)) ui.post(() -> { if (o.optBoolean("on")) SignInService.start(this); else SignInService.stop(this); });
            } catch (Exception ignored) {}
        }
    }

    /** To the page, on the main thread; kept until the page has said hello. */
    private void post(String m) {
        ui.post(() -> {
            if (page == null) { toPage.add(m); return; }
            page.postMessage(m);
        });
    }
    private void flushToPage() {
        List<String> all = new ArrayList<>(toPage);
        toPage.clear();
        for (String m : all) page.postMessage(m);
    }

    private void reply(JSONObject req, boolean ok, Object value, String error) {
        try {
            JSONObject r = new JSONObject();
            r.put("id", req.optLong("id"));
            r.put("ok", ok);
            r.put("value", value == null ? JSONObject.NULL : value);
            if (error != null) r.put("error", error);
            post("R" + ascii(r.toString()));
        } catch (Exception ignored) {}
    }

    private void appRequest(String json) {
        JSONObject req;
        try { req = new JSONObject(json); } catch (Exception e) { return; }
        switch (req.optString("op")) {
            case "openUrl": openUrl(req.optString("url")); reply(req, true, true, null); break;
            case "background": moveTaskToBack(true); reply(req, true, true, null); break;
            case "saveFile": saveFile(req); break;
            case "downloadUpdate": {
                String err = updater.download(req.optString("url"), req.optString("version"), req.optBoolean("auto"), () -> {});
                reply(req, err == null, true, err); break;
            }
            case "installUpdate": updater.install(req.optString("url"), req.optString("version")); reply(req, true, true, null); break;
            case "prayerSchedule": {
                try {
                    String muted = PrayerBell.schedule(this, req.optJSONArray("bells") == null ? new org.json.JSONArray() : req.getJSONArray("bells"), req.optString("sound"));
                    JSONObject r = new JSONObject(); r.put("mutedDay", muted);
                    reply(req, true, r, null);
                } catch (Exception e) { reply(req, false, null, e.getMessage()); }
                break;
            }
            case "prayerTest": PrayerBell.show(this, req.optJSONObject("bell") == null ? new JSONObject() : req.optJSONObject("bell"), req.optString("sound")); reply(req, true, true, null); break;
            case "notifyPermission":
                if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED) reply(req, true, true, null);
                else { pendingPermission = req; notifyPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS); }
                break;
            case "bars": systemBars(req.optString("color"), req.optBoolean("light")); reply(req, true, true, null); break;
            default: reply(req, false, null, "Unknown request");
        }
    }

    /** Android asks where to keep a file the engine wrote (a backup, an export). */
    private void saveFile(JSONObject req) {
        try {
            File f = new File(req.getString("path")).getCanonicalFile();
            File tmp = getCacheDir().getCanonicalFile();
            if (!f.getPath().startsWith(tmp.getPath() + File.separator) || !f.isFile()) { reply(req, false, null, "Nothing to save"); return; }
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(req.optString("mime", "application/octet-stream"));
            i.putExtra(Intent.EXTRA_TITLE, req.optString("name", "WellWrite"));
            pendingSave = req;
            saver.launch(i);
        } catch (Exception e) {
            pendingSave = null;
            reply(req, false, null, "Couldn’t save the file");
        }
    }

    /**
     * The phone's camera app takes the photo straight into WellWrite's private cache (not your gallery); the page
     * then puts it, encrypted, in your entry. Left-over copies are removed next time WellWrite opens.
     */
    private boolean takePhoto() {
        try {
            File dir = new File(getCacheDir(), "camera");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            cameraFile = new File(dir, "WellWrite photo " + new SimpleDateFormat("yyyy-MM-dd HHmmss", Locale.ROOT).format(new Date()) + ".jpg");
            Uri out = FileProvider.getUriForFile(this, getPackageName() + ".files", cameraFile);
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, out);
            i.setClipData(ClipData.newRawUri("", out));
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            camera.launch(i);
            return true;
        } catch (Exception e) {
            cameraFile = null;
            return false;   // no camera app: fall back to choosing a photo
        }
    }

    private static void clearCameraCache(File cache) {
        File[] old = new File(cache, "camera").listFiles();
        if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    /** The status and navigation bars take the colour of the page behind them (dark icons on a light page). */
    private void systemBars(String color, boolean light) {
        try {
            int c = Color.parseColor(color);
            if (root != null) root.setBackgroundColor(c);
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            bars.setAppearanceLightStatusBars(light);
            bars.setAppearanceLightNavigationBars(light);
        } catch (Exception ignored) {}
    }

    private void openUrl(String url) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (ActivityNotFoundException ignored) {}
    }

    private static String ascii(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c < 0x7f) b.append(c); else b.append(String.format("\\u%04x", (int) c));
        }
        return b.toString();
    }

    /** Opened from the prayer bell: show "Pause for prayer". */
    private void prayerFrom(Intent i) {
        if (i == null || !i.hasExtra(PrayerBell.EXTRA_KEY)) return;
        String key = i.getStringExtra(PrayerBell.EXTRA_KEY);
        i.removeExtra(PrayerBell.EXTRA_KEY);
        try { post("Q" + ascii(new JSONObject().put("key", key == null ? JSONObject.NULL : key).toString())); } catch (Exception ignored) {}
    }

    @Override
    protected void onNewIntent(Intent i) { super.onNewIntent(i); setIntent(i); prayerFrom(i); }

    @Override
    protected void onResume() { super.onResume(); if (updater != null) updater.onResume(); }

    @Override
    protected void onDestroy() {
        NodeBridge.setListener(null);
        if (web != null) { ((ViewGroup) web.getParent()).removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }
}

package com.chrisgribble.wellwrite;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
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
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
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
import java.util.ArrayList;
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
    private JavaScriptReplyProxy page;
    private final List<String> toPage = new ArrayList<>();

    private ValueCallback<Uri[]> chooserCallback;
    private ActivityResultLauncher<Intent> chooser;
    private ActivityResultLauncher<Intent> saver;
    private JSONObject pendingSave;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        EdgeToEdge.enable(this);
        super.onCreate(saved);
        NodeBridge.start(this);

        FrameLayout root = new FrameLayout(this);
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
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                boolean images = false;
                for (String a : params.getAcceptTypes()) if (a != null && a.startsWith("image/")) images = true;
                i.setType(images ? "image/*" : "*/*");
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
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
    }

    // ---------- messages ----------
    private void fromEngine(String m) {
        if (m.isEmpty()) return;
        char kind = m.charAt(0);
        if (kind == 'P') post(m);
        else if (kind == 'N') {
            try {
                JSONObject o = new JSONObject(m.substring(1));
                if ("openUrl".equals(o.optString("op"))) ui.post(() -> openUrl(o.optString("url")));
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

    @Override
    protected void onDestroy() {
        NodeBridge.setListener(null);
        if (web != null) { ((ViewGroup) web.getParent()).removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }
}

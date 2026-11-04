package com.chrisgribble.wellwrite;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * WellWrite's engine: Node.js, running src/backend.js (the same code as the Windows app) on its own thread.
 * It starts once per app process and keeps running while the app is alive.
 */
public final class NodeBridge {
    private static final String TAG = "WellWrite";
    private static final String CHANNEL = "wellwrite";

    static {
        System.loadLibrary("node");
        System.loadLibrary("wellwrite-node");
    }

    private static native int startNode(String[] arguments);
    private static native void sendToNode(String channel, String message);

    public interface Listener { void onMessage(String message); }

    private static boolean started = false;
    private static Listener listener;
    private static final List<String> waiting = new ArrayList<>();

    /** Messages from the engine go to the app window; kept until there is one. */
    public static synchronized void setListener(Listener l) {
        listener = l;
        if (l != null) { for (String m : waiting) l.onMessage(m); waiting.clear(); }
    }

    /** Called by the native code, on Node's thread. */
    @SuppressWarnings("unused")
    static void fromNode(String channel, String message) {
        Listener l;
        synchronized (NodeBridge.class) {
            l = listener;
            if (l == null) { waiting.add(message); return; }
        }
        l.onMessage(message);
    }

    public static void send(String message) { sendToNode(CHANNEL, message); }

    public static synchronized void start(Context context) {
        if (started) return;
        started = true;
        final Context app = context.getApplicationContext();
        final String secret = DeviceKey.secretHex(app);
        // Node's work (big backups, the Bible search) gets a roomier stack than Android's default.
        Thread t = new Thread(null, () -> {
            try {
                File project = new File(app.getFilesDir(), "nodejs-project");
                copyProjectIfNew(app, project);
                File cache = app.getCacheDir();
                startNode(new String[] { "node", new File(project, "main.js").getAbsolutePath(),
                        app.getFilesDir().getAbsolutePath(), cache.getAbsolutePath() });
                Log.e(TAG, "Node stopped");
            } catch (Exception e) {
                Log.e(TAG, "Couldn't start WellWrite's engine", e);
            }
        }, "WellWrite engine", 8 * 1024 * 1024);
        t.start();
        // Queued until the engine is listening.
        send("S{\"type\":\"secret\",\"key\":\"" + secret + "\"}");
    }

    /** The engine's files ship inside the app; copy them out once per installed version. */
    private static void copyProjectIfNew(Context c, File project) throws Exception {
        PackageInfo info = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
        SharedPreferences prefs = c.getSharedPreferences("engine", Context.MODE_PRIVATE);
        long installed = info.lastUpdateTime;
        if (project.isDirectory() && prefs.getLong("copied", 0) == installed) return;
        deleteAll(project);
        copyAssets(c.getAssets(), "nodejs-project", project);
        prefs.edit().putLong("copied", installed).apply();
    }

    private static void deleteAll(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteAll(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static void copyAssets(AssetManager am, String from, File to) throws IOException {
        String[] list = am.list(from);
        if (list == null || list.length == 0) {
            to.getParentFile().mkdirs();
            try (InputStream in = am.open(from); OutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return;
        }
        to.mkdirs();
        for (String name : list) copyAssets(am, from + "/" + name, new File(to, name));
    }

    private NodeBridge() {}
}

package com.chrisgribble.wellwrite;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Listening to the Bible with the screen off. The chapter plays in WellWrite's page; this keeps WellWrite awake while
 * it does, with a quiet "Listening: John 3" notification that has Pause/Play and Stop. Stops when you stop.
 */
public class ListenService extends Service {
    private static final String CHANNEL = "listening";
    private static final int NOTE_ID = 11;
    static final String PLAY = "com.chrisgribble.wellwrite.LISTEN_PLAY", PAUSE = "com.chrisgribble.wellwrite.LISTEN_PAUSE",
            STOP = "com.chrisgribble.wellwrite.LISTEN_STOP", SHOW = "com.chrisgribble.wellwrite.LISTEN_SHOW";

    /** Where the notification's buttons go: the page (set by MainActivity while it's alive). */
    interface Sink { void send(String cmd); }
    static volatile Sink sink;

    private PowerManager.WakeLock wake;

    static void show(Context c, String title, String text, boolean playing) {
        try {
            Intent i = new Intent(c, ListenService.class).setAction(SHOW)
                    .putExtra("title", title).putExtra("text", text).putExtra("playing", playing);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception ignored) {}   // not allowed right now (e.g. started from the background): it still plays while open
    }
    static void stop(Context c) { try { c.stopService(new Intent(c, ListenService.class)); } catch (Exception ignored) {} }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null || intent.getAction() == null ? SHOW : intent.getAction();
        if (!SHOW.equals(a)) {
            Sink s = sink;
            String cmd = PLAY.equals(a) ? "play" : PAUSE.equals(a) ? "pause" : "stop";
            if (s != null) s.send(cmd);
            if (s == null || STOP.equals(a)) { stopSelf(); return START_NOT_STICKY; }
            return START_NOT_STICKY;   // the page answers with the new state, which updates this notification
        }
        boolean playing = intent.getBooleanExtra("playing", true);
        Notification n = note(intent.getStringExtra("title"), intent.getStringExtra("text"), playing);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTE_ID, n);
        } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        // Awake while playing (the screen may be off); paused, it may sleep.
        if (playing) {
            if (wake == null) {
                wake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WellWrite:listening");
                wake.setReferenceCounted(false);
            }
            wake.acquire(3 * 60 * 60 * 1000L);   // three hours at most
        } else if (wake != null && wake.isHeld()) wake.release();
        return START_NOT_STICKY;
    }

    private Notification note(String title, String text, boolean playing) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Listening to the Bible", NotificationManager.IMPORTANCE_LOW);
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
            b = new Notification.Builder(this, CHANNEL);
        } else b = new Notification.Builder(this);
        int f = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent open = PendingIntent.getActivity(this, 20, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP), f);
        PendingIntent toggle = PendingIntent.getService(this, 21, new Intent(this, ListenService.class).setAction(playing ? PAUSE : PLAY), f);
        PendingIntent stop = PendingIntent.getService(this, 22, new Intent(this, ListenService.class).setAction(STOP), f);
        return b.setSmallIcon(R.drawable.ic_bell)
                .setContentTitle("Listening: " + (title == null || title.isEmpty() ? "the Bible" : title))
                .setContentText(text == null ? "" : text)
                .setContentIntent(open)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .addAction(new Notification.Action.Builder(null, playing ? "Pause" : "Play", toggle).build())
                .addAction(new Notification.Action.Builder(null, "Stop", stop).build())
                .build();
    }

    @Override public void onDestroy() { if (wake != null && wake.isHeld()) wake.release(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}

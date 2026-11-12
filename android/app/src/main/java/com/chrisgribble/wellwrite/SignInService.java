package com.chrisgribble.wellwrite;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps WellWrite running while you sign in to Google in the browser. Android freezes apps soon after you leave
 * them, and the browser hands the sign-in back to a little server inside WellWrite, which has to be awake to
 * answer. Runs only for the sign-in (at most three minutes), with a quiet "Signing in to Google" notification.
 */
public class SignInService extends Service {
    private static final String CHANNEL = "signin";

    static void start(Context c) {
        try {
            Intent i = new Intent(c, SignInService.class);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception ignored) {}   // not allowed right now: sign-in still works if you come back to WellWrite
    }
    static void stop(Context c) { try { c.stopService(new Intent(c, SignInService.class)); } catch (Exception ignored) {} }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Signing in", NotificationManager.IMPORTANCE_LOW));
            b = new Notification.Builder(this, CHANNEL);
        } else b = new Notification.Builder(this);
        Notification n = b.setContentTitle("Signing in to Google")
                .setContentText("Finish in your browser, then come back to WellWrite.")
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setOngoing(true).build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
            else startForeground(1, n);
        } catch (Exception e) { stopSelf(); }
        return START_NOT_STICKY;
    }

    @Override public void onTimeout(int startId) { stopSelf(); }   // Android's limit for short tasks
    @Override public IBinder onBind(Intent intent) { return null; }
}

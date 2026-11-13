package com.chrisgribble.wellwrite;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * The prayer bell on Android. WellWrite's engine works out the bells to come (src/prayer.js) and hands them here;
 * Android's alarm clock rings each one, even when WellWrite is closed, and after the phone restarts.
 * A ring is a gentle notification (a soft bell, or silent) with "Pray" and "Mute today", which goes away by itself.
 */
public class PrayerBell extends BroadcastReceiver {
    static final String RING = "com.chrisgribble.wellwrite.PRAYER_RING";
    static final String MUTE = "com.chrisgribble.wellwrite.PRAYER_MUTE";
    static final String EXTRA_KEY = "prayerKey";
    private static final String CH_BELL = "prayer_bell_3", CH_QUIET = "prayer_quiet";
    private static final int NOTE_ID = 7;

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("prayer", Context.MODE_PRIVATE); }
    static String today() { return new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date()); }
    static String mutedDay(Context c) { return prefs(c).getString("mutedDay", ""); }

    /** From the page: the bells to come ([{ at, key, date, title, body }]) and the sound. Returns today's mute, if any. */
    static String schedule(Context c, JSONArray bells, String sound) {
        prefs(c).edit().putString("bells", bells.toString()).putString("sound", "silent".equals(sound) ? "silent" : "bell").apply();
        armNext(c);
        String m = mutedDay(c);
        return today().equals(m) ? m : "";
    }

    /** Set the alarm for the next bell that isn't muted. */
    static void armNext(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, 1, new Intent(c, PrayerBell.class).setAction(RING),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
        JSONObject next = nextBell(c, System.currentTimeMillis());
        if (next == null) return;
        long at = next.optLong("at");
        try {
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setWindow(AlarmManager.RTC_WAKEUP, at, 5 * 60 * 1000L, pi);   // within five minutes
        } catch (SecurityException e) {
            am.setWindow(AlarmManager.RTC_WAKEUP, at, 5 * 60 * 1000L, pi);
        }
    }

    private static JSONObject nextBell(Context c, long after) {
        try {
            JSONArray bells = new JSONArray(prefs(c).getString("bells", "[]"));
            String muted = mutedDay(c);
            for (int i = 0; i < bells.length(); i++) {
                JSONObject b = bells.getJSONObject(i);
                if (b.optLong("at") > after && !b.optString("date").equals(muted)) return b;
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** The bell that's due now (rung up to 10 minutes late, never later). */
    private static JSONObject dueBell(Context c, long now) {
        try {
            JSONArray bells = new JSONArray(prefs(c).getString("bells", "[]"));
            String muted = mutedDay(c);
            JSONObject due = null;
            for (int i = 0; i < bells.length(); i++) {
                JSONObject b = bells.getJSONObject(i);
                long at = b.optLong("at");
                if (at <= now + 60000 && at > now - 10 * 60000 && !b.optString("date").equals(muted)) due = b;
            }
            return due;
        } catch (Exception e) { return null; }
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent.getAction() == null ? "" : intent.getAction();
        if (MUTE.equals(a)) {
            prefs(c).edit().putString("mutedDay", today()).apply();
            ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE_ID);
            armNext(c);
            return;
        }
        if (RING.equals(a)) {
            JSONObject b = dueBell(c, System.currentTimeMillis());
            String last = prefs(c).getString("lastRung", "");
            if (b != null && !last.equals(b.optString("date") + b.optString("key"))) {
                prefs(c).edit().putString("lastRung", b.optString("date") + b.optString("key")).apply();
                show(c, b, prefs(c).getString("sound", "bell"));
            }
        }
        // Boot, an update, the clock changing, or after ringing: arm the next one.
        armNext(c);
    }

    /** Show a bell (also used by "Try the bell"). */
    static void show(Context c, JSONObject b, String sound) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        boolean quiet = "silent".equals(sound);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel bell = new NotificationChannel(CH_BELL, "Prayer bell", NotificationManager.IMPORTANCE_DEFAULT);
            bell.setDescription("A soft bell at the hours you choose");
            bell.setSound(Uri.parse("android.resource://" + c.getPackageName() + "/" + R.raw.prayer_bell),
                    new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            bell.enableVibration(false);
            NotificationChannel silent = new NotificationChannel(CH_QUIET, "Prayer bell (silent)", NotificationManager.IMPORTANCE_LOW);
            silent.setSound(null, null);
            nm.createNotificationChannel(bell);
            nm.createNotificationChannel(silent);
        }
        Intent open = new Intent(c, MainActivity.class).putExtra(EXTRA_KEY, b.optString("key"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pray = PendingIntent.getActivity(c, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent mute = PendingIntent.getBroadcast(c, 3, new Intent(c, PrayerBell.class).setAction(MUTE), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder n = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, quiet ? CH_QUIET : CH_BELL) : new Notification.Builder(c);
        n.setSmallIcon(R.drawable.ic_bell)
                .setContentTitle(b.optString("title", "A moment for prayer"))
                .setContentText(b.optString("body"))
                .setStyle(new Notification.BigTextStyle().bigText(b.optString("body")))
                .setContentIntent(pray)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .addAction(new Notification.Action.Builder(null, "Pray", pray).build())
                .addAction(new Notification.Action.Builder(null, "Mute today", mute).build());
        if (Build.VERSION.SDK_INT >= 26) n.setTimeoutAfter(45 * 60 * 1000L);   // gone after 45 minutes
        else if (!quiet) n.setSound(Uri.parse("android.resource://" + c.getPackageName() + "/" + R.raw.prayer_bell));
        try { nm.notify(NOTE_ID, n.build()); } catch (SecurityException ignored) {}   // notifications not allowed
    }
}

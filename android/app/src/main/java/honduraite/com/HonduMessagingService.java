package honduraite.com;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Push estilo WhatsApp:
 * - Suena con canal MAX + tono nativo
 * - Enciende pantalla (wake lock + full-screen intent en bloqueo)
 * - Banner heads-up aunque la app esté en otra app / cerrada
 *
 * Requiere FCM data-only en Android (sin android.notification) para que
 * onMessageReceived se ejecute también en background.
 */
public class HonduMessagingService extends FirebaseMessagingService {

    private static final String TAG = "HonduPush";

    /** Debe coincidir con functions/index.js y js/fcm-push.js */
    public static final String WA_CHANNEL_ID = "hondu_wa_alert_v7";
    public static final String WA_CHANNEL_NAME = "HonduRaite tipo WhatsApp";
    private static final String WA_GROUP = "honduraite_wa_group";

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        try {
            PushNotificationsPlugin.onNewToken(token);
        } catch (Exception e) {
            Log.w(TAG, "onNewToken forward: " + e.getMessage());
        }
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        // Siempre notificar a Capacitor/JS (app abierta o reanudando)
        try {
            PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
        } catch (Exception e) {
            Log.w(TAG, "sendRemoteMessage: " + e.getMessage());
        }

        Map<String, String> data = remoteMessage.getData();
        String title = firstNonEmpty(
            data != null ? data.get("title") : null,
            remoteMessage.getNotification() != null ? remoteMessage.getNotification().getTitle() : null,
            "HonduRaite"
        );
        String body = firstNonEmpty(
            data != null ? data.get("body") : null,
            remoteMessage.getNotification() != null ? remoteMessage.getNotification().getBody() : null,
            "Tienes un aviso nuevo"
        );

        // App en primer plano: el JS ya muestra banner/tono; no duplicar
        if (MainActivity.isAppInForeground()) {
            return;
        }

        ensureWhatsAppChannel(this);
        wakeScreenBriefly(this);
        showWhatsAppStyleNotification(this, title, body, data, remoteMessage.getMessageId());
    }

    public static void ensureWhatsAppChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm == null) return;

            NotificationChannel existing = nm.getNotificationChannel(WA_CHANNEL_ID);
            if (existing != null) return;

            NotificationChannel ch = new NotificationChannel(
                WA_CHANNEL_ID,
                WA_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );
            ch.setDescription("Avisos que encienden la pantalla y suenan (estilo WhatsApp)");
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 400, 120, 400, 120, 600, 100, 800});
            ch.enableLights(true);
            ch.setLightColor(Color.parseColor("#25D366")); // verde WA
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ch.setShowBadge(true);
            ch.setBypassDnd(false);

            Uri soundUri = Uri.parse(
                "android.resource://" + context.getPackageName() + "/" + R.raw.hondu_ride
            );
            AudioAttributes aa = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            ch.setSound(soundUri, aa);

            nm.createNotificationChannel(ch);
        } catch (Exception e) {
            Log.w(TAG, "ensureWhatsAppChannel: " + e.getMessage());
        }
    }

    private static void wakeScreenBriefly(Context context) {
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock wl = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                    | PowerManager.ACQUIRE_CAUSES_WAKEUP
                    | PowerManager.ON_AFTER_RELEASE,
                "honduraite:wa_push"
            );
            wl.acquire(3500L);
        } catch (Exception e) {
            Log.w(TAG, "wakeScreen: " + e.getMessage());
        }
    }

    private static void showWhatsAppStyleNotification(
        Context context,
        String title,
        String body,
        Map<String, String> data,
        String messageId
    ) {
        try {
            ensureWhatsAppChannel(context);

            Intent open = new Intent(context, MainActivity.class);
            open.setAction(Intent.ACTION_MAIN);
            open.addCategory(Intent.CATEGORY_LAUNCHER);
            open.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP
                    | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            );
            open.putExtra(MainActivity.EXTRA_FROM_PUSH_WAKE, true);
            open.putExtra(MainActivity.EXTRA_PUSH_TITLE, title);
            open.putExtra(MainActivity.EXTRA_PUSH_BODY, body);
            if (messageId != null) open.putExtra("google.message_id", messageId);
            if (data != null) {
                for (Map.Entry<String, String> e : data.entrySet()) {
                    if (e.getKey() != null && e.getValue() != null) {
                        open.putExtra(e.getKey(), e.getValue());
                    }
                }
            }

            int reqCode = (int) (System.currentTimeMillis() & 0x0FFFFFFF);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                piFlags |= PendingIntent.FLAG_IMMUTABLE;
            }

            PendingIntent contentPi = PendingIntent.getActivity(context, reqCode, open, piFlags);
            // Full-screen intent: enciende pantalla bloqueada (como llamada/mensaje WA urgente)
            PendingIntent fullScreenPi = PendingIntent.getActivity(
                context,
                reqCode + 1,
                open,
                piFlags
            );

            Uri soundUri = Uri.parse(
                "android.resource://" + context.getPackageName() + "/" + R.raw.hondu_ride
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, WA_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setOnlyAlertOnce(false)
                .setDefaults(0)
                .setSound(soundUri)
                .setVibrate(new long[]{0, 400, 120, 400, 120, 600, 100, 800})
                .setLights(Color.parseColor("#25D366"), 600, 400)
                .setContentIntent(contentPi)
                .setFullScreenIntent(fullScreenPi, true)
                .setGroup(WA_GROUP)
                .setNumber(1);

            // Color de acento tipo chat
            try {
                builder.setColor(Color.parseColor("#25D366"));
            } catch (Exception ignored) {}

            int notifId = reqCode;
            if (data != null && data.get("tripId") != null) {
                notifId = 700000 + Math.abs(data.get("tripId").hashCode() % 90000);
            }

            NotificationManagerCompat.from(context).notify(notifId, builder.build());
        } catch (Exception e) {
            Log.e(TAG, "showWhatsAppStyleNotification: " + e.getMessage(), e);
        }
    }

    private static String firstNonEmpty(String... values) {
        if (values == null) return "";
        for (String v : values) {
            if (v != null && !v.trim().isEmpty()) return v.trim();
        }
        return "";
    }
}

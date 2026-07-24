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
 * Push estilo WhatsApp / llamada:
 * - Canal MAX + tono nativo
 * - Enciende pantalla (wake lock + full-screen intent en bloqueo)
 * - Heads-up aunque la app esté en otra app / cerrada
 * - Ofertas de viaje usan CATEGORY_CALL (más agresivo en OEMs)
 *
 * Requiere FCM data-only en Android (sin android.notification) para que
 * onMessageReceived se ejecute también en background.
 */
public class HonduMessagingService extends FirebaseMessagingService {

    private static final String TAG = "HonduPush";

    /** Debe coincidir con functions/index.js y js/fcm-push.js */
    public static final String WA_CHANNEL_ID = "hondu_wa_alert_v8";
    public static final String WA_CHANNEL_NAME = "HonduRaite viajes (enciende pantalla)";
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

        boolean tripAlert = isTripWakeAlert(data);
        ensureWhatsAppChannel(this);
        wakeScreenBriefly(this, tripAlert ? 8000L : 4000L);
        showWhatsAppStyleNotification(this, title, body, data, remoteMessage.getMessageId(), tripAlert);
    }

    public static void ensureWhatsAppChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm == null) return;

            NotificationChannel existing = nm.getNotificationChannel(WA_CHANNEL_ID);
            if (existing != null) {
                // Si el usuario no silenció el canal, reforzar vibración/luz
                return;
            }

            // IMPORTANCE_MAX (5): heads-up + sonido aunque la pantalla esté apagada
            NotificationChannel ch = new NotificationChannel(
                WA_CHANNEL_ID,
                WA_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );
            // En API 26+ no hay IMPORTANCE_MAX en NotificationManager (solo HIGH=4).
            // PRIORITY_MAX va en la notificación. Usamos HIGH + full-screen + wake.
            try {
                // Algunos OEMs respetan setBypassDnd para alertas de viaje
                ch.setBypassDnd(false);
            } catch (Exception ignored) {}
            ch.setDescription("Avisos de viaje: suenan y encienden la pantalla (estilo WhatsApp), aunque estés en otra app.");
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 450, 100, 450, 100, 600, 100, 800, 100, 950});
            ch.enableLights(true);
            ch.setLightColor(Color.parseColor("#25D366"));
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ch.setShowBadge(true);

            Uri soundUri = Uri.parse(
                "android.resource://" + context.getPackageName() + "/" + R.raw.hondu_ride
            );
            AudioAttributes aa = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            ch.setSound(soundUri, aa);

            nm.createNotificationChannel(ch);
        } catch (Exception e) {
            Log.w(TAG, "ensureWhatsAppChannel: " + e.getMessage());
        }
    }

    /** Viajes / ofertas / llegada: merecen wake + full-screen más agresivo. */
    private static boolean isTripWakeAlert(Map<String, String> data) {
        if (data == null) return true; // por defecto agresivo
        String type = firstNonEmpty(data.get("type"), "");
        String tag = firstNonEmpty(data.get("tag"), "");
        String openDriver = firstNonEmpty(data.get("openDriver"), "");
        String style = firstNonEmpty(data.get("style"), "");
        if ("whatsapp".equalsIgnoreCase(style) || "true".equalsIgnoreCase(openDriver)) return true;
        if (type.isEmpty() && tag.isEmpty()) return true;
        return "trip_offer".equals(type)
            || "ride_demand_alert".equals(type)
            || "freight_trip_alert".equals(type)
            || "new_trip_staff".equals(type)
            || "driver_bid".equals(type)
            || "passenger_counter".equals(type)
            || "trip_accepted".equals(type)
            || "trip_arrived".equals(type)
            || "trip_price_boost".equals(type)
            || "trip_started".equals(type)
            || "scheduled_trip_active".equals(type)
            || "scheduled_reminder".equals(type)
            || "trip_scheduled_reserved".equals(type)
            || "staff_created_trip".equals(type)
            || tag.startsWith("trip-offer-")
            || tag.startsWith("freight-alert-")
            || tag.startsWith("ride-demand-")
            || tag.startsWith("staff-trip-")
            || tag.startsWith("driver-bid-")
            || tag.startsWith("passenger-counter-")
            || tag.startsWith("trip-price-boost-")
            || tag.startsWith("trip-accepted-")
            || tag.startsWith("trip-arrived-");
    }

    private static void wakeScreenBriefly(Context context, long ms) {
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
            wl.acquire(Math.max(2500L, Math.min(ms, 15000L)));
        } catch (Exception e) {
            Log.w(TAG, "wakeScreen: " + e.getMessage());
        }
    }

    private static void showWhatsAppStyleNotification(
        Context context,
        String title,
        String body,
        Map<String, String> data,
        String messageId,
        boolean tripAlert
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
            open.putExtra(MainActivity.EXTRA_TRIP_WAKE, tripAlert);
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
            // Full-screen intent: enciende pantalla bloqueada (como llamada / WA urgente)
            PendingIntent fullScreenPi = PendingIntent.getActivity(
                context,
                reqCode + 1,
                open,
                piFlags
            );

            Uri soundUri = Uri.parse(
                "android.resource://" + context.getPackageName() + "/" + R.raw.hondu_ride
            );

            // Ofertas de viaje: CATEGORY_CALL → OEMs tratan más como llamada (enciende pantalla)
            String category = tripAlert
                ? NotificationCompat.CATEGORY_CALL
                : NotificationCompat.CATEGORY_MESSAGE;

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, WA_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(category)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setOnlyAlertOnce(false)
                .setDefaults(0)
                .setSound(soundUri)
                .setVibrate(new long[]{0, 450, 100, 450, 100, 600, 100, 800, 100, 950})
                .setLights(Color.parseColor("#25D366"), 600, 400)
                .setContentIntent(contentPi)
                .setFullScreenIntent(fullScreenPi, true)
                .setGroup(WA_GROUP)
                .setNumber(1)
                .setTimeoutAfter(tripAlert ? 120_000L : 60_000L);

            if (tripAlert) {
                // Más insistente en viajes: no se “aplana” tan fácil en la bandeja
                builder.setOngoing(false);
            }

            try {
                builder.setColor(Color.parseColor("#25D366"));
            } catch (Exception ignored) {}

            int notifId = reqCode;
            if (data != null && data.get("tripId") != null) {
                notifId = 700000 + Math.abs(data.get("tripId").hashCode() % 90000);
            }

            NotificationManagerCompat.from(context).notify(notifId, builder.build());

            // En algunos OEMs el full-screen no abre la app si no hay permiso;
            // el wake lock ya intentó encender. Log para depurar.
            if (tripAlert && Build.VERSION.SDK_INT >= 34) {
                try {
                    NotificationManager nm = context.getSystemService(NotificationManager.class);
                    if (nm != null && !nm.canUseFullScreenIntent()) {
                        Log.w(TAG, "Full-screen intent NO concedido: el aviso suena pero puede no abrir sobre bloqueo. Pide permiso en Ajustes.");
                    }
                } catch (Exception ignored) {}
            }
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

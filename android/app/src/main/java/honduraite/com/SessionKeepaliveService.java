package honduraite.com;

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
import androidx.core.app.NotificationCompat;

/**
 * Foreground service estilo Uber:
 * - Sesión en línea (baja prioridad)
 * - Viaje activo (mayor prioridad + texto "Viaje en curso")
 * Mantiene proceso vivo para GPS/WebView en segundo plano.
 */
public class SessionKeepaliveService extends Service {

    public static final String ACTION_START = "honduraite.com.action.START_KEEPALIVE";
    public static final String ACTION_STOP = "honduraite.com.action.STOP_KEEPALIVE";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_BODY = "body";
    public static final String EXTRA_DRIVER_MODE = "driverMode";
    public static final String EXTRA_TRIP_MODE = "tripMode";

    private static final String CHANNEL_ID = "honduraite_session_keepalive";
    private static final String TRIP_CHANNEL_ID = "honduraite_live_trip_v1";
    private static final int NOTIFICATION_ID = 41001;

    private static volatile boolean running = false;
    private static volatile boolean driverMode = false;
    private static volatile boolean tripMode = false;
    private static volatile boolean bubbleEnabled = true;
    private static volatile String lastTitle = "";
    private static volatile String lastBody = "";

    public static boolean isRunning() {
        return running;
    }

    public static boolean isTripMode() {
        return tripMode;
    }

    public static void notifyAppBackgrounded(Context context) {
        if (!running || !bubbleEnabled) return;
        BubbleOverlayHelper.resetDismissForNextBackground();
        BubbleOverlayHelper.show(context);
    }

    public static void notifyAppForegrounded() {
        BubbleOverlayHelper.hide();
        BubbleOverlayHelper.resetDismissForNextBackground();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            if (running) {
                promoteToForeground(
                    lastTitle.isEmpty() ? getString(R.string.keepalive_title) : lastTitle,
                    lastBody.isEmpty() ? getString(R.string.keepalive_body) : lastBody
                );
                return START_STICKY;
            }
            stopSelf();
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            running = false;
            driverMode = false;
            tripMode = false;
            lastTitle = "";
            lastBody = "";
            BubbleOverlayHelper.hide();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        String title = intent.getStringExtra(EXTRA_TITLE);
        String body = intent.getStringExtra(EXTRA_BODY);
        driverMode = intent.getBooleanExtra(EXTRA_DRIVER_MODE, false);
        tripMode = intent.getBooleanExtra(EXTRA_TRIP_MODE, false);
        bubbleEnabled = true;
        running = true;

        if (title == null || title.isEmpty()) {
            title = tripMode
                ? getString(R.string.live_trip_title)
                : getString(R.string.keepalive_title);
        }
        if (body == null || body.isEmpty()) {
            if (tripMode) {
                body = driverMode
                    ? getString(R.string.live_trip_body_driver)
                    : getString(R.string.live_trip_body_passenger);
            } else {
                body = driverMode
                    ? getString(R.string.keepalive_body_driver)
                    : getString(R.string.keepalive_body);
            }
        }

        lastTitle = title;
        lastBody = body;
        promoteToForeground(title, body);
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (running) {
            Intent restart = new Intent(getApplicationContext(), SessionKeepaliveService.class);
            restart.setAction(ACTION_START);
            restart.putExtra(EXTRA_DRIVER_MODE, driverMode);
            restart.putExtra(EXTRA_TRIP_MODE, tripMode);
            restart.putExtra(EXTRA_TITLE, lastTitle);
            restart.putExtra(EXTRA_BODY, lastBody);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(restart);
            } else {
                startService(restart);
            }
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        BubbleOverlayHelper.hide();
        super.onDestroy();
    }

    private void promoteToForeground(String title, String body) {
        createChannels();
        Notification notification = buildNotification(title, body);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // En viaje o conductor: LOCATION + DATA_SYNC (GPS en background)
            int type = (driverMode || tripMode)
                ? (ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION | ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
            startForeground(NOTIFICATION_ID, notification, type);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel session = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.keepalive_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        session.setDescription(getString(R.string.keepalive_channel_desc));
        session.setShowBadge(false);
        manager.createNotificationChannel(session);

        // Viaje: importancia DEFAULT para que el SO no mate el servicio tan fácil
        NotificationChannel trip = new NotificationChannel(
            TRIP_CHANNEL_ID,
            getString(R.string.live_trip_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        trip.setDescription(getString(R.string.live_trip_channel_desc));
        trip.setShowBadge(true);
        trip.setSound(null, null);
        manager.createNotificationChannel(trip);
    }

    private Notification buildNotification(String title, String body) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String channel = tripMode ? TRIP_CHANNEL_ID : CHANNEL_ID;
        int priority = tripMode
            ? NotificationCompat.PRIORITY_DEFAULT
            : NotificationCompat.PRIORITY_LOW;

        return new NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(tripMode
                ? NotificationCompat.CATEGORY_NAVIGATION
                : NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(pendingIntent)
            .setPriority(priority)
            .build();
    }
}

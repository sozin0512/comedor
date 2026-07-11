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

public class SessionKeepaliveService extends Service {

    public static final String ACTION_START = "honduraite.com.action.START_KEEPALIVE";
    public static final String ACTION_STOP = "honduraite.com.action.STOP_KEEPALIVE";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_BODY = "body";
    public static final String EXTRA_DRIVER_MODE = "driverMode";

    private static final String CHANNEL_ID = "honduraite_session_keepalive";
    private static final int NOTIFICATION_ID = 41001;

    private static volatile boolean running = false;
    private static volatile boolean driverMode = false;
    private static volatile boolean bubbleEnabled = true;

    public static boolean isRunning() {
        return running;
    }

    public static void notifyAppBackgrounded(Context context) {
        if (!running || !bubbleEnabled) return;
        // Al salir de la app siempre se puede mostrar la burbuja de nuevo
        // (aunque el usuario la haya cerrado con X la vez anterior)
        BubbleOverlayHelper.resetDismissForNextBackground();
        BubbleOverlayHelper.show(context);
    }

    public static void notifyAppForegrounded() {
        // Dentro de la app no se ve la burbuja; al salir reaparecerá
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
                promoteToForeground(getString(R.string.keepalive_title), getString(R.string.keepalive_body));
                return START_STICKY;
            }
            stopSelf();
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            running = false;
            driverMode = false;
            BubbleOverlayHelper.hide();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        String title = intent.getStringExtra(EXTRA_TITLE);
        String body = intent.getStringExtra(EXTRA_BODY);
        driverMode = intent.getBooleanExtra(EXTRA_DRIVER_MODE, false);
        bubbleEnabled = true;
        running = true;

        if (title == null || title.isEmpty()) {
            title = getString(R.string.keepalive_title);
        }
        if (body == null || body.isEmpty()) {
            body = driverMode
                ? getString(R.string.keepalive_body_driver)
                : getString(R.string.keepalive_body);
        }

        promoteToForeground(title, body);
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (running) {
            Intent restart = new Intent(getApplicationContext(), SessionKeepaliveService.class);
            restart.setAction(ACTION_START);
            restart.putExtra(EXTRA_DRIVER_MODE, driverMode);
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
        createChannel();
        Notification notification = buildNotification(title, body);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int type = driverMode
                ? (ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION | ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
            startForeground(NOTIFICATION_ID, notification, type);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.keepalive_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.keepalive_channel_desc));
        channel.setShowBadge(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
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

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }
}
package honduraite.com;

import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SessionKeepalive")
public class SessionKeepalivePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String title = call.getString("title", getContext().getString(R.string.keepalive_title));
        String body = call.getString("body", getContext().getString(R.string.keepalive_body));
        boolean driverMode = Boolean.TRUE.equals(call.getBoolean("driverMode", false));
        boolean tripMode = Boolean.TRUE.equals(call.getBoolean("tripMode", false));

        Intent intent = new Intent(getContext(), SessionKeepaliveService.class);
        intent.setAction(SessionKeepaliveService.ACTION_START);
        intent.putExtra(SessionKeepaliveService.EXTRA_TITLE, title);
        intent.putExtra(SessionKeepaliveService.EXTRA_BODY, body);
        intent.putExtra(SessionKeepaliveService.EXTRA_DRIVER_MODE, driverMode);
        intent.putExtra(SessionKeepaliveService.EXTRA_TRIP_MODE, tripMode);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), SessionKeepaliveService.class);
        intent.setAction(SessionKeepaliveService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void hasOverlayPermission(PluginCall call) {
        com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
        ret.put("granted", BubbleOverlayHelper.canDraw(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(getContext())) {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void isActive(PluginCall call) {
        com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
        ret.put("active", SessionKeepaliveService.isRunning());
        ret.put("tripMode", SessionKeepaliveService.isTripMode());
        call.resolve(ret);
    }

    @PluginMethod
    public void hasBatteryExemption(PluginCall call) {
        com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
            ret.put("granted", pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        } else {
            ret.put("granted", true);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getContext().getPackageName())) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);
        call.resolve();
    }

    /**
     * Android 14+ (API 34): permiso de pantalla completa / heads-up agresivo (estilo Temu).
     * En versiones anteriores se considera concedido si las notificaciones están activas.
     */
    @PluginMethod
    public void hasFullScreenIntentPermission(PluginCall call) {
        JSObject ret = new JSObject();
        boolean granted = true;
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                NotificationManager nm =
                    (NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
                granted = nm != null && nm.canUseFullScreenIntent();
            }
        } catch (Exception e) {
            granted = true;
        }
        ret.put("granted", granted);
        call.resolve(ret);
    }

    /**
     * Abre el ajuste del sistema para permitir full-screen intent (notificaciones emergentes).
     */
    @PluginMethod
    public void requestFullScreenIntentPermission(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                NotificationManager nm =
                    (NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
                boolean already = nm != null && nm.canUseFullScreenIntent();
                if (!already) {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                    intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getActivity().startActivity(intent);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                // Fallback: ajustes de notificaciones de la app
                Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
            }
        } catch (Exception e) {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
            } catch (Exception ignored) {}
        }
        call.resolve();
    }

    /** Estado de notificaciones del sistema (canales / bloqueo total). */
    @PluginMethod
    public void areNotificationsEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        boolean enabled = true;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                NotificationManager nm =
                    (NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
                enabled = nm != null && nm.areNotificationsEnabled();
            }
        } catch (Exception e) {
            enabled = true;
        }
        ret.put("enabled", enabled);
        call.resolve(ret);
    }
}
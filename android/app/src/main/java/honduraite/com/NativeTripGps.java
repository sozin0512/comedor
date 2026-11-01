package honduraite.com;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.content.ContextCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * 2026.10.26.30 — GPS nativo durante un viaje activo.
 *
 * Antes la ubicación salía SOLO del WebView (navigator.geolocation + setInterval de JS).
 * Al pasar la app a segundo plano Android/Chromium pausa el WebView: el servicio en primer plano
 * mantenía el proceso vivo y la notificación «Viaje en curso», pero nadie pedía GPS ni escribía
 * en Firestore. Este helper pide el GPS desde código nativo (LocationManager, dentro del servicio
 * de tipo LOCATION) y escribe por REST con el token del propio conductor:
 *  - artifacts/{appId}/public/data/drivers_location/{uid}  (lat, lng, heading, accuracy, online, appVisible…)
 *  - artifacts/{appId}/public/data/trips/{tripId}          (driverLive*)
 * Solo escribe mientras la app NO está en pantalla (en pantalla lo sigue haciendo el JS) y
 * se detiene sola si el viaje deja de estar accepted / in_progress.
 */
public final class NativeTripGps {

    private static final String TAG = "NativeTripGps";
    private static final String PREFS = "hr_native_trip_gps";
    private static final long MIN_INTERVAL_MS = 3000L;
    private static final long WRITE_EVERY_MS = 4000L;
    private static final long TRIP_CHECK_EVERY_MS = 30000L;
    private static final long MAX_RUN_MS = 6L * 60L * 60L * 1000L; // tope de seguridad: 6 h

    private static NativeTripGps instance;

    private final Context ctx;
    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private HandlerThread thread;
    private Handler handler;
    private LocationManager lm;
    private PowerManager.WakeLock wakeLock;
    private final LocationListener listener = new LocationListener() {
        @Override public void onLocationChanged(Location loc) { onFix(loc); }
        @Override public void onStatusChanged(String p, int s, Bundle b) {}
        @Override public void onProviderEnabled(String p) {}
        @Override public void onProviderDisabled(String p) {}
    };

    // Config
    private String apiKey, projectId, appId, uid, tripId, idToken, refreshToken;
    private long idTokenExpMs;
    private long startedAt;
    private volatile long lastWriteAt;
    private volatile long lastTripCheckAt;
    private volatile Location lastLoc;
    private volatile boolean active;

    private NativeTripGps(Context c) { ctx = c.getApplicationContext(); }

    public static synchronized NativeTripGps get(Context c) {
        if (instance == null) instance = new NativeTripGps(c);
        return instance;
    }

    public boolean isActive() { return active; }
    public String getTripId() { return tripId; }

    /** Guarda la config (también para sobrevivir a un reinicio del servicio) y arranca. */
    public synchronized void start(JSONObject cfg) {
        if (cfg != null) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("cfg", cfg.toString()).apply();
        }
        JSONObject c = cfg != null ? cfg : loadCfg();
        if (c == null) return;
        apiKey = c.optString("apiKey", "");
        projectId = c.optString("projectId", "");
        appId = c.optString("appId", "");
        uid = c.optString("uid", "");
        String newTrip = c.optString("tripId", "");
        idToken = c.optString("idToken", "");
        refreshToken = c.optString("refreshToken", "");
        idTokenExpMs = System.currentTimeMillis() + 50L * 60L * 1000L;
        if (apiKey.isEmpty() || projectId.isEmpty() || appId.isEmpty() || uid.isEmpty() || newTrip.isEmpty()
            || (idToken.isEmpty() && refreshToken.isEmpty())) {
            Log.w(TAG, "config incompleta; no arranca");
            return;
        }
        boolean sameTrip = active && newTrip.equals(tripId);
        tripId = newTrip;
        if (sameTrip) return;
        stopUpdates();
        if (!hasFine() && !hasCoarse()) {
            Log.w(TAG, "sin permiso de ubicación");
            return;
        }
        startedAt = System.currentTimeMillis();
        lastTripCheckAt = startedAt;
        active = true;
        thread = new HandlerThread("hr-trip-gps");
        thread.start();
        handler = new Handler(thread.getLooper());
        acquireWakeLock();
        requestUpdates(thread.getLooper());
    }

    public synchronized void stop() {
        active = false;
        stopUpdates();
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("cfg").apply();
        tripId = null;
    }

    private JSONObject loadCfg() {
        try {
            String s = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("cfg", null);
            return s != null ? new JSONObject(s) : null;
        } catch (Exception e) { return null; }
    }

    private boolean hasFine() {
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }
    private boolean hasCoarse() {
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressLint("MissingPermission")
    private void requestUpdates(Looper looper) {
        try {
            lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return;
            if (hasFine() && lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, MIN_INTERVAL_MS, 0f, listener, looper);
            }
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, MIN_INTERVAL_MS * 2, 0f, listener, looper);
            }
        } catch (Exception e) {
            Log.w(TAG, "requestLocationUpdates: " + e.getMessage());
        }
    }

    private void stopUpdates() {
        try { if (lm != null) lm.removeUpdates(listener); } catch (Exception ignored) {}
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
        wakeLock = null;
        if (thread != null) { thread.quitSafely(); thread = null; }
        handler = null;
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "HonduRaite:tripGps");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(MAX_RUN_MS);
        } catch (Exception ignored) {}
    }

    private void onFix(Location loc) {
        if (!active || loc == null) return;
        Location prev = lastLoc;
        // Preferir GPS: ignorar un fix de red mucho peor que uno de GPS reciente
        if (prev != null && LocationManager.NETWORK_PROVIDER.equals(loc.getProvider())
            && LocationManager.GPS_PROVIDER.equals(prev.getProvider())
            && loc.getTime() - prev.getTime() < 15000 && loc.getAccuracy() > prev.getAccuracy() * 2) {
            return;
        }
        lastLoc = loc;
        long now = System.currentTimeMillis();
        if (now - startedAt > MAX_RUN_MS) { stop(); return; }
        if (MainActivity.isAppInForeground()) return; // en pantalla escribe el WebView
        if (now - lastWriteAt < WRITE_EVERY_MS) return;
        lastWriteAt = now;
        final Location l = loc;
        final boolean checkTrip = now - lastTripCheckAt > TRIP_CHECK_EVERY_MS;
        if (checkTrip) lastTripCheckAt = now;
        net.execute(() -> pushFix(l, checkTrip));
    }

    // ---------------- REST ----------------

    private void pushFix(Location l, boolean checkTrip) {
        try {
            if (!ensureToken()) return;
            final String tid = tripId;
            if (tid == null) return;
            if (checkTrip && !tripStillLive(tid)) {
                Log.i(TAG, "viaje ya no está activo; detengo GPS nativo");
                stop();
                return;
            }
            long now = System.currentTimeMillis();
            Double heading = l.hasBearing() ? (double) l.getBearing() : null;
            Double acc = l.hasAccuracy() ? (double) l.getAccuracy() : null;

            JSONObject loc = new JSONObject();
            loc.put("lat", dbl(l.getLatitude()));
            loc.put("lng", dbl(l.getLongitude()));
            loc.put("heading", heading != null ? dbl(heading) : nul());
            loc.put("accuracy", acc != null ? dbl(acc) : nul());
            loc.put("online", bool(true));
            loc.put("appVisible", bool(false));
            loc.put("appVisibleAt", intv(now));
            loc.put("nativeBgGps", bool(true));
            loc.put("updatedAt", intv(now));
            patch("drivers_location/" + enc(uid), loc);

            JSONObject trip = new JSONObject();
            trip.put("driverLiveLat", dbl(l.getLatitude()));
            trip.put("driverLiveLng", dbl(l.getLongitude()));
            trip.put("driverLiveHeading", heading != null ? dbl(heading) : nul());
            trip.put("driverLiveAccuracy", acc != null ? dbl(acc) : nul());
            trip.put("driverLiveUpdatedAt", intv(now));
            patch("trips/" + enc(tid), trip);
        } catch (Exception e) {
            Log.w(TAG, "pushFix: " + e.getMessage());
        }
    }

    private boolean tripStillLive(String tid) {
        try {
            HttpURLConnection c = open(docUrl("trips/" + enc(tid)) + "?mask.fieldPaths=status&mask.fieldPaths=driverId", "GET");
            int code = c.getResponseCode();
            if (code == 404 || code == 403) return false;
            if (code != 200) return true; // error de red: no cortar
            JSONObject f = new JSONObject(read(c.getInputStream())).optJSONObject("fields");
            if (f == null) return false;
            String status = f.optJSONObject("status") != null ? f.optJSONObject("status").optString("stringValue", "") : "";
            String driver = f.optJSONObject("driverId") != null ? f.optJSONObject("driverId").optString("stringValue", "") : "";
            return ("accepted".equals(status) || "in_progress".equals(status)) && uid.equals(driver);
        } catch (Exception e) {
            return true;
        }
    }

    private void patch(String relPath, JSONObject fields) throws Exception {
        StringBuilder url = new StringBuilder(docUrl(relPath)).append('?');
        java.util.Iterator<String> it = fields.keys();
        boolean first = true;
        while (it.hasNext()) {
            if (!first) url.append('&');
            first = false;
            url.append("updateMask.fieldPaths=").append(enc(it.next()));
        }
        HttpURLConnection c = open(url.toString(), "PATCH");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        byte[] body = new JSONObject().put("fields", fields).toString().getBytes("UTF-8");
        try (OutputStream os = c.getOutputStream()) { os.write(body); }
        int code = c.getResponseCode();
        if (code == 401) idTokenExpMs = 0; // forzar refresh la próxima vez
        if (code >= 300) Log.w(TAG, "PATCH " + relPath + " -> " + code);
        c.disconnect();
    }

    private synchronized boolean ensureToken() {
        if (!idToken.isEmpty() && System.currentTimeMillis() < idTokenExpMs) return true;
        if (refreshToken.isEmpty()) return !idToken.isEmpty();
        try {
            URL u = new URL("https://securetoken.googleapis.com/v1/token?key=" + enc(apiKey));
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            byte[] body = ("grant_type=refresh_token&refresh_token=" + enc(refreshToken)).getBytes("UTF-8");
            try (OutputStream os = c.getOutputStream()) { os.write(body); }
            if (c.getResponseCode() != 200) return false;
            JSONObject r = new JSONObject(read(c.getInputStream()));
            idToken = r.optString("id_token", idToken);
            refreshToken = r.optString("refresh_token", refreshToken);
            long expSec = r.optLong("expires_in", 3600);
            idTokenExpMs = System.currentTimeMillis() + Math.max(60, expSec - 300) * 1000L;
            return !idToken.isEmpty();
        } catch (Exception e) {
            return false;
        }
    }

    private String docUrl(String relPath) {
        // Rutas de la colección: tripId / uid ya codificados por el llamador
        return "https://firestore.googleapis.com/v1/projects/" + projectId
            + "/databases/(default)/documents/artifacts/" + appId + "/public/data/" + relPath;
    }

    private HttpURLConnection open(String url, String method) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        if ("PATCH".equals(method)) {
            c.setRequestMethod("POST");
            c.setRequestProperty("X-HTTP-Method-Override", "PATCH");
        } else {
            c.setRequestMethod(method);
        }
        c.setRequestProperty("Authorization", "Bearer " + idToken);
        return c;
    }

    private static String read(InputStream in) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        in.close();
        return bos.toString("UTF-8");
    }

    private static String enc(String s) {
        try { return URLEncoder.encode(s, "UTF-8").replace("+", "%20"); } catch (Exception e) { return s; }
    }
    private static JSONObject dbl(double v) throws Exception { return new JSONObject().put("doubleValue", v); }
    private static JSONObject intv(long v) throws Exception { return new JSONObject().put("integerValue", String.valueOf(v)); }
    private static JSONObject bool(boolean v) throws Exception { return new JSONObject().put("booleanValue", v); }
    private static JSONObject nul() throws Exception { return new JSONObject().put("nullValue", JSONObject.NULL); }
}

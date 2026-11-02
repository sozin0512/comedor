package honduraite.com;

import android.app.DownloadManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Descarga APKs con el DownloadManager del sistema.
 * Chrome Custom Tabs / WebView a menudo dejan la descarga de Firebase Storage a medias;
 * el DownloadManager completa el archivo en Descargas y notifica al terminar.
 */
@CapacitorPlugin(name = "ApkDownload")
public class ApkDownloadPlugin extends Plugin {

    @PluginMethod
    public void download(PluginCall call) {
        // 2026.10.26.31: versión Play Store — las actualizaciones las maneja Google Play.
        call.reject("Descarga de APK deshabilitada: actualiza desde Google Play");
    }

    @PluginMethod
    public void openExternalBrowser(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("URL vacía");
            return;
        }
        try {
            android.content.Intent intent = new android.content.Intent(
                android.content.Intent.ACTION_VIEW,
                Uri.parse(url.trim())
            );
            // Forzar app externa (Chrome/navegador), no Custom Tab del WebView
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addCategory(android.content.Intent.CATEGORY_BROWSABLE);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo abrir el navegador: " + e.getMessage(), e);
        }
    }

    /**
     * versionName + versionCode reales del APK instalado (PackageManager).
     * Más fiable que Capacitor App.getInfo() en algunos WebViews.
     */
    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageManager pm = ctx.getPackageManager();
            String pkg = ctx.getPackageName();
            PackageInfo info;
            if (Build.VERSION.SDK_INT >= 33) {
                info = pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0));
            } else {
                info = pm.getPackageInfo(pkg, 0);
            }
            long versionCode;
            if (Build.VERSION.SDK_INT >= 28) {
                versionCode = info.getLongVersionCode();
            } else {
                versionCode = info.versionCode;
            }
            JSObject ret = new JSObject();
            ret.put("versionName", info.versionName != null ? info.versionName : "");
            ret.put("versionCode", versionCode);
            ret.put("packageName", pkg);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo leer la versión instalada: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Long downloadId = call.getLong("downloadId");
        if (downloadId == null) {
            call.reject("downloadId requerido");
            return;
        }
        DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) {
            call.reject("DownloadManager no disponible");
            return;
        }
        DownloadManager.Query q = new DownloadManager.Query();
        q.setFilterById(downloadId);
        try (Cursor c = dm.query(q)) {
            JSObject ret = new JSObject();
            if (c != null && c.moveToFirst()) {
                int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                int reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                long soFar = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                String statusLabel = "unknown";
                if (status == DownloadManager.STATUS_SUCCESSFUL) statusLabel = "successful";
                else if (status == DownloadManager.STATUS_FAILED) statusLabel = "failed";
                else if (status == DownloadManager.STATUS_PAUSED) statusLabel = "paused";
                else if (status == DownloadManager.STATUS_PENDING) statusLabel = "pending";
                else if (status == DownloadManager.STATUS_RUNNING) statusLabel = "running";
                ret.put("status", statusLabel);
                ret.put("reason", reason);
                ret.put("bytesSoFar", soFar);
                ret.put("totalBytes", total);
            } else {
                ret.put("status", "not_found");
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    private static String sanitizeFileName(String name) {
        if (name == null || name.trim().isEmpty()) return "HonduRaite.apk";
        String safe = name.trim().replaceAll("[^a-zA-Z0-9._\\-]+", "_");
        if (safe.length() > 80) safe = safe.substring(0, 80);
        return safe;
    }
}

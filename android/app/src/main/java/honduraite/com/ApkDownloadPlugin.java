package honduraite.com;

import android.app.DownloadManager;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
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
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("URL de descarga vacía");
            return;
        }

        String fileName = call.getString("fileName", "HonduRaite.apk");
        fileName = sanitizeFileName(fileName);
        if (!fileName.toLowerCase().endsWith(".apk")) {
            fileName = fileName + ".apk";
        }

        try {
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) {
                call.reject("DownloadManager no disponible");
                return;
            }

            Uri uri = Uri.parse(url.trim());
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle("HonduRaite · " + fileName);
            request.setDescription("Descargando actualización…");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(
                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
            );
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);
            request.setAllowedNetworkTypes(
                DownloadManager.Request.NETWORK_WIFI | DownloadManager.Request.NETWORK_MOBILE
            );
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

            // Firebase Storage usa query tokens; no reescribir la URL
            long id = dm.enqueue(request);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("downloadId", id);
            ret.put("fileName", fileName);
            ret.put("pathHint", "Descargas/" + fileName);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo iniciar la descarga: " + e.getMessage(), e);
        }
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

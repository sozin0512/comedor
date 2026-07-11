package honduraite.com;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Reserva espacio de la barra de estado / notch / navegación en el WebView.
 * Sin esto (edge-to-edge en Android 14/15+), el header de la app queda bajo la
 * barra del sistema y al tocar botones de arriba se baja la cortina de notificaciones.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SessionKeepalivePlugin.class);
        registerPlugin(ApkDownloadPlugin.class);
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);
        setupSystemBarsAndInsets();
    }

    private void setupSystemBarsAndInsets() {
        try {
            // Edge-to-edge controlado: nosotros aplicamos el padding del WebView
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            getWindow().setStatusBarColor(Color.parseColor("#F8FAFC"));
            getWindow().setNavigationBarColor(Color.parseColor("#F8FAFC"));

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                getWindow().setStatusBarContrastEnforced(false);
                getWindow().setNavigationBarContrastEnforced(true);
            }

            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            if (controller != null) {
                controller.setAppearanceLightStatusBars(true);
                controller.setAppearanceLightNavigationBars(true);
            }

            final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) return;

            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            // Evita que un pull-down del contenido “enrosque” con el gesto del sistema
            webView.setVerticalScrollBarEnabled(false);

            ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                        | WindowInsetsCompat.Type.displayCutout()
                );
                // Espacio real de status bar / notch / nav bar → el header ya no queda “debajo”
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(webView);

            // Por si el bridge aún no había medido: reintentar en el siguiente frame
            webView.post(() -> ViewCompat.requestApplyInsets(webView));
        } catch (Exception e) {
            android.util.Log.w("MainActivity", "setupSystemBarsAndInsets: " + e.getMessage());
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        SessionKeepaliveService.notifyAppForegrounded();
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                ViewCompat.requestApplyInsets(webView);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        SessionKeepaliveService.notifyAppBackgrounded(this);
        super.onPause();
    }
}

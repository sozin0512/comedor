package honduraite.com;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Reserva espacio de la barra de estado / notch / navegación.
 * En Android 14/15+ (edge-to-edge), sin insets el header queda bajo el reloj y
 * al tocar botones de arriba se baja la cortina de notificaciones.
 *
 * Estrategia:
 * 1) Edge-to-edge visual (status bar clara).
 * 2) NO paddear el WebView (evita doble hueco con CSS).
 * 3) Inyectar --native-safe-top/bottom al CSS con el inset real + un respiro.
 */
public class MainActivity extends BridgeActivity {
    /** Aire extra bajo status bar para que los botones no activen la cortina de notificaciones. */
    private static final float EXTRA_TOP_DP = 18f;
    private static final float EXTRA_BOTTOM_DP = 6f;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SessionKeepalivePlugin.class);
        registerPlugin(ApkDownloadPlugin.class);
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);
        setupSystemBarsAndInsets();
        // Bridge/WebView a veces termina de montarse un frame después
        final View decor = getWindow() != null ? getWindow().getDecorView() : null;
        if (decor != null) {
            decor.post(this::setupSystemBarsAndInsets);
            decor.postDelayed(this::setupSystemBarsAndInsets, 120);
            decor.postDelayed(this::setupSystemBarsAndInsets, 400);
        }
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()
        ));
    }

    private void injectSafeAreaCss(WebView webView, int top, int bottom, int left, int right) {
        if (webView == null) return;
        // Valores en px CSS lógicos: Android px ≈ CSS px en density-independent WebView
        // Usamos densidad para pasar dp-like: bars.top ya viene en px de pantalla.
        // En WebView, 1 CSS px ≈ 1 hardware px / devicePixelRatio; evaluateJavascript
        // recibe px físicos — convertir a CSS px con density.
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) density = 1f;
        int cssTop = Math.round(top / density);
        int cssBottom = Math.round(bottom / density);
        int cssLeft = Math.round(left / density);
        int cssRight = Math.round(right / density);
        // Mínimos de seguridad (status bar típico ~24–28dp + gesto notificaciones)
        if (cssTop < 48) cssTop = 48;
        if (cssBottom < 10) cssBottom = 10;

        final String js =
            "(function(){try{"
                + "var r=document.documentElement;"
                + "r.style.setProperty('--native-safe-top','" + cssTop + "px');"
                + "r.style.setProperty('--native-safe-bottom','" + cssBottom + "px');"
                + "r.style.setProperty('--native-safe-left','" + cssLeft + "px');"
                + "r.style.setProperty('--native-safe-right','" + cssRight + "px');"
                + "r.classList.add('native-insets-ready');"
                + "if(document.body){document.body.classList.add('native-insets-ready');}"
                + "}catch(e){}})();";
        try {
            webView.evaluateJavascript(js, null);
        } catch (Exception ignored) {}
    }

    private void setupSystemBarsAndInsets() {
        try {
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
            webView.setVerticalScrollBarEnabled(false);
            // El respiro lo hace el CSS con --native-safe-*; no paddear el WebView
            // (padding nativo + CSS = doble hueco).
            webView.setPadding(0, 0, 0, 0);
            if (webView.getLayoutParams() instanceof ViewGroup.MarginLayoutParams) {
                ViewGroup.MarginLayoutParams lp =
                    (ViewGroup.MarginLayoutParams) webView.getLayoutParams();
                if (lp.topMargin != 0 || lp.bottomMargin != 0 || lp.leftMargin != 0 || lp.rightMargin != 0) {
                    lp.setMargins(0, 0, 0, 0);
                    webView.setLayoutParams(lp);
                }
            }

            final int extraTop = dp(EXTRA_TOP_DP);
            final int extraBottom = dp(EXTRA_BOTTOM_DP);

            ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                        | WindowInsetsCompat.Type.displayCutout()
                );
                int top = bars.top + extraTop;
                int bottom = bars.bottom + extraBottom;
                injectSafeAreaCss(webView, top, bottom, bars.left, bars.right);
                // No consumir del todo: deja que hijos puedan leer insets si hace falta
                return windowInsets;
            });

            // También en el root de contenido (más fiable en algunos OEMs)
            View content = findViewById(android.R.id.content);
            if (content != null) {
                ViewCompat.setOnApplyWindowInsetsListener(content, (v, windowInsets) -> {
                    Insets bars = windowInsets.getInsets(
                        WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout()
                    );
                    injectSafeAreaCss(webView, bars.top + extraTop, bars.bottom + extraBottom, bars.left, bars.right);
                    return windowInsets;
                });
                ViewCompat.requestApplyInsets(content);
            }

            ViewCompat.requestApplyInsets(webView);
            webView.post(() -> {
                ViewCompat.requestApplyInsets(webView);
                // Fallback si aún no hubo callback de insets
                WindowInsetsCompat wi = ViewCompat.getRootWindowInsets(webView);
                if (wi != null) {
                    Insets bars = wi.getInsets(
                        WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout()
                    );
                    injectSafeAreaCss(webView, bars.top + extraTop, bars.bottom + extraBottom, bars.left, bars.right);
                } else {
                    // Sin insets: mínimo razonable (~status bar + aire)
                    injectSafeAreaCss(webView, dp(40), dp(16), 0, 0);
                }
            });
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
                webView.post(() -> {
                    WindowInsetsCompat wi = ViewCompat.getRootWindowInsets(webView);
                    if (wi != null) {
                        Insets bars = wi.getInsets(
                            WindowInsetsCompat.Type.systemBars()
                                | WindowInsetsCompat.Type.displayCutout()
                        );
                        injectSafeAreaCss(
                            webView,
                            bars.top + dp(EXTRA_TOP_DP),
                            bars.bottom + dp(EXTRA_BOTTOM_DP),
                            bars.left,
                            bars.right
                        );
                    }
                });
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        SessionKeepaliveService.notifyAppBackgrounded(this);
        super.onPause();
    }
}

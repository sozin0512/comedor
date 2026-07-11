package honduraite.com;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

/**
 * Burbuja flotante (draw over other apps).
 * - Arrastrable
 * - Tap: abre la app
 * - X: cierra solo hasta la próxima vez que el usuario salga de la app
 */
public final class BubbleOverlayHelper {

    private static View bubbleView;
    private static WindowManager windowManager;
    private static WindowManager.LayoutParams layoutParams;
    private static float lastTouchX;
    private static float lastTouchY;
    private static int initialX;
    private static int initialY;
    /** Cerrada con X en este periodo en segundo plano; se resetea al volver a la app. */
    private static boolean dismissedUntilNextLeave = false;

    private BubbleOverlayHelper() {}

    public static boolean canDraw(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        return Settings.canDrawOverlays(context);
    }

    /** Llamar al entrar a la app: la X se “olvida” y la próxima salida vuelve a mostrar la burbuja. */
    public static void resetDismissForNextBackground() {
        dismissedUntilNextLeave = false;
    }

    public static void show(Context context) {
        if (!canDraw(context)) return;
        if (dismissedUntilNextLeave) return;
        if (bubbleView != null) return;

        Context appContext = context.getApplicationContext();
        windowManager = (WindowManager) appContext.getSystemService(Context.WINDOW_SERVICE);
        if (windowManager == null) return;

        int sizePx = dp(appContext, 58);
        int marginPx = dp(appContext, 16);
        int closeSize = dp(appContext, 22);

        FrameLayout container = new FrameLayout(appContext);
        container.setContentDescription("HonduRaite activo");

        // Círculo principal con icono
        FrameLayout bubble = new FrameLayout(appContext);
        FrameLayout.LayoutParams bubbleLp = new FrameLayout.LayoutParams(sizePx, sizePx);
        bubbleLp.gravity = Gravity.BOTTOM | Gravity.START;
        bubbleLp.topMargin = dp(appContext, 8);
        bubbleLp.rightMargin = dp(appContext, 8);
        bubble.setLayoutParams(bubbleLp);

        ImageView icon = new ImageView(appContext);
        icon.setImageResource(R.mipmap.ic_launcher);
        icon.setScaleType(ImageView.ScaleType.CENTER_CROP);
        FrameLayout.LayoutParams iconLp = new FrameLayout.LayoutParams(
            sizePx - dp(appContext, 8),
            sizePx - dp(appContext, 8)
        );
        iconLp.gravity = Gravity.CENTER;
        icon.setLayoutParams(iconLp);

        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0xFFFFFFFF);
        bg.setStroke(dp(appContext, 2), 0xFF2563EB);
        bubble.setBackground(bg);
        bubble.setElevation(dp(appContext, 8));
        bubble.addView(icon);
        container.addView(bubble);

        // Botón X (cerrar burbuja)
        TextView closeBtn = new TextView(appContext);
        closeBtn.setText("×");
        closeBtn.setTextColor(Color.WHITE);
        closeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        closeBtn.setGravity(Gravity.CENTER);
        closeBtn.setContentDescription("Cerrar burbuja");
        closeBtn.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);

        GradientDrawable closeBg = new GradientDrawable();
        closeBg.setShape(GradientDrawable.OVAL);
        closeBg.setColor(0xE6111827);
        closeBg.setStroke(dp(appContext, 1), 0x66FFFFFF);
        closeBtn.setBackground(closeBg);
        closeBtn.setElevation(dp(appContext, 10));

        FrameLayout.LayoutParams closeLp = new FrameLayout.LayoutParams(closeSize, closeSize);
        closeLp.gravity = Gravity.TOP | Gravity.END;
        closeBtn.setLayoutParams(closeLp);
        container.addView(closeBtn);

        int layoutType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

        int totalW = sizePx + dp(appContext, 10);
        int totalH = sizePx + dp(appContext, 10);

        layoutParams = new WindowManager.LayoutParams(
            totalW,
            totalH,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        );
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        layoutParams.x = marginPx;
        layoutParams.y = dp(appContext, 120);

        closeBtn.setOnClickListener(v -> {
            // Como otras apps de burbuja: cierra ahora; al salir de nuevo de la app reaparece
            dismissedUntilNextLeave = true;
            hide();
        });

        View.OnTouchListener dragListener = (v, event) -> {
            if (layoutParams == null || windowManager == null || bubbleView == null) return false;
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    lastTouchX = event.getRawX();
                    lastTouchY = event.getRawY();
                    initialX = layoutParams.x;
                    initialY = layoutParams.y;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    layoutParams.x = initialX + Math.round(event.getRawX() - lastTouchX);
                    layoutParams.y = initialY + Math.round(event.getRawY() - lastTouchY);
                    try {
                        windowManager.updateViewLayout(bubbleView, layoutParams);
                    } catch (Exception ignored) {}
                    return true;
                case MotionEvent.ACTION_UP:
                    float dx = Math.abs(event.getRawX() - lastTouchX);
                    float dy = Math.abs(event.getRawY() - lastTouchY);
                    if (dx < 12 && dy < 12 && v != closeBtn) {
                        openApp(appContext);
                    }
                    return true;
                default:
                    return false;
            }
        };

        bubble.setOnTouchListener(dragListener);
        container.setOnTouchListener(dragListener);

        bubbleView = container;
        try {
            windowManager.addView(bubbleView, layoutParams);
        } catch (Exception ignored) {
            bubbleView = null;
            windowManager = null;
            layoutParams = null;
        }
    }

    public static void hide() {
        if (bubbleView == null || windowManager == null) {
            bubbleView = null;
            windowManager = null;
            layoutParams = null;
            return;
        }
        try {
            windowManager.removeView(bubbleView);
        } catch (Exception ignored) {}
        bubbleView = null;
        windowManager = null;
        layoutParams = null;
    }

    private static void openApp(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        context.startActivity(intent);
    }

    private static int dp(Context context, int value) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            context.getResources().getDisplayMetrics()
        ));
    }
}

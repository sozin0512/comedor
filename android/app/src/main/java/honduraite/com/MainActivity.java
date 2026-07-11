package honduraite.com;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SessionKeepalivePlugin.class);
        registerPlugin(ApkDownloadPlugin.class);
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);
    }

    @Override
    public void onResume() {
        super.onResume();
        SessionKeepaliveService.notifyAppForegrounded();
    }

    @Override
    public void onPause() {
        SessionKeepaliveService.notifyAppBackgrounded(this);
        super.onPause();
    }
}
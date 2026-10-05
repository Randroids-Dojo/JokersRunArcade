package app.toyboxes.jokersrun;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.KeyEvent;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import org.json.JSONArray;

/** A single, offline game surface. No remote pages or private-data bridge. */
public final class MainActivity extends Activity {
    private WebView webView;
    private static final String START = "https://appassets.androidplatform.net/assets/index.html";

    @Override @SuppressLint("SetJavaScriptEnabled")
    public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(5, 8, 12));
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        // Keep the controls outside camera cutouts, including forced large-screen layouts.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
                var cutout = insets.getDisplayCutout();
                view.setPadding(cutout.getSafeInsetLeft(), cutout.getSafeInsetTop(),
                        cutout.getSafeInsetRight(), cutout.getSafeInsetBottom());
            } else view.setPadding(0, 0, 0, 0);
            return insets;
        });
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.addJavascriptInterface(new Haptics(), "JokerHaptics");
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse local = loader.shouldInterceptRequest(request.getUrl());
                if (local != null) return local;
                // No fallback to the network, including missing assets or unexpected origins.
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
                        java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"https".equals(uri.getScheme())
                        || !"appassets.androidplatform.net".equals(uri.getHost())
                        || !uri.getPath().startsWith("/assets/");
            }
            @Override public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript("navigator.vibrate = p => JokerHaptics.vibrate(JSON.stringify(Array.isArray(p) ? p : [p]));", null);
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        String debugQuery = BuildConfig.DEBUG ? getIntent().getStringExtra("debugQuery") : null;
        webView.loadUrl(START + (debugQuery == null ? "" : "?" + debugQuery));
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::gameBack);
        }
        immersive();
    }

    private void gameBack() {
        webView.evaluateJavascript("typeof jokerNativeBack === 'function' ? jokerNativeBack() : true", value -> {
            if ("true".equals(value)) finish();
        });
    }
    @Override public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (Build.VERSION.SDK_INT < 33 && keyCode == KeyEvent.KEYCODE_BACK) {
            gameBack();
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) immersive();
    }
    @SuppressWarnings("deprecation") private void immersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
    @Override protected void onPause() {
        if (webView != null) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('joker:native-pause'))", null);
            webView.onPause();
        }
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("window.dispatchEvent(new Event('joker:native-resume'))", null);
        }
    }
    @Override protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("JokerHaptics");
            ((FrameLayout) webView.getParent()).removeView(webView);
            webView.destroy();
        }
        super.onDestroy();
    }
    private final class Haptics {
        @JavascriptInterface public boolean vibrate(String json) {
            try {
                JSONArray values = new JSONArray(json);
                int n = Math.min(values.length(), 8);
                long[] pattern = new long[n + 1];
                for (int i = 0; i < n; i++) pattern[i + 1] = Math.max(0, Math.min(100, values.optLong(i)));
                Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (vibrator == null || !vibrator.hasVibrator()) return false;
                if (n == 0 || (n == 1 && pattern[1] == 0)) vibrator.cancel();
                else vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
                return true;
            } catch (Exception ignored) { return false; }
        }
    }
}

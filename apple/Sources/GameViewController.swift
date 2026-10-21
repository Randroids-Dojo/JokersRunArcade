import AVFAudio
import UIKit
import WebKit

final class GameViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let assets = GameAssets()
    private var observers: [NSObjectProtocol] = []
    private var haptics: [DispatchWorkItem] = []
    private let impact = UIImpactFeedbackGenerator(style: .light)

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 5 / 255, green: 8 / 255, blue: 12 / 255, alpha: 1)
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(assets, forURLScheme: GameAssets.scheme)
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.userContentController.add(WeakScriptHandler(self), name: "haptics")
        configuration.userContentController.addUserScript(WKUserScript(source: """
            navigator.vibrate = pattern => {
              const values = (Array.isArray(pattern) ? pattern : [pattern]).slice(0, 8);
              window.webkit.messageHandlers.haptics.postMessage(values);
              return true;
            };
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.translatesAutoresizingMaskIntoConstraints = false
        #if DEBUG
        webView.isInspectable = true
        #endif
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification,
                                             object: nil, queue: .main) { [weak self] _ in
            self?.suspend()
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification,
                                             object: nil, queue: .main) { [weak self] _ in
            self?.webView.evaluateJavaScript("window.dispatchEvent(new Event('joker:native-resume'))")
        })
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification,
                                             object: nil, queue: .main) { [weak self] _ in
            self?.suspend()
        })
        webView.load(URLRequest(url: GameAssets.origin))
    }

    private func suspend() {
        haptics.forEach { $0.cancel() }
        haptics.removeAll()
        webView.evaluateJavaScript("window.dispatchEvent(new Event('joker:native-pause'))")
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        decisionHandler(url?.scheme == GameAssets.scheme && url?.host == "app" ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView,
                 requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(frame.isMainFrame && origin.protocol == GameAssets.scheme && origin.host == "app" ? .prompt : .deny)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == GameAssets.scheme,
              message.frameInfo.securityOrigin.host == "app",
              let values = message.body as? [NSNumber] else { return }
        haptics.forEach { $0.cancel() }
        haptics.removeAll()
        var delay = 0.0
        for (index, number) in values.prefix(8).enumerated() {
            let duration = max(0, min(100, number.doubleValue)) / 1000
            if index.isMultiple(of: 2) && duration > 0 {
                let work = DispatchWorkItem { [weak self] in self?.impact.impactOccurred() }
                haptics.append(work)
                DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
            }
            delay += duration
        }
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        haptics.forEach { $0.cancel() }
    }
}

private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

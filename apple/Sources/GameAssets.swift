import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves only the game's bundled files. There is no network fallback.
final class GameAssets: NSObject, WKURLSchemeHandler {
    static let scheme = "joker-game"
    static let origin = URL(string: "joker-game://app/")!
    private let root = Bundle.main.bundleURL.appendingPathComponent("Game", isDirectory: true)

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              url.scheme == Self.scheme, url.host == "app",
              ["GET", "HEAD"].contains(urlSchemeTask.request.httpMethod ?? "GET") else {
            urlSchemeTask.didFailWithError(URLError(.unsupportedURL))
            return
        }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/"),
              let data = try? Data(contentsOf: file) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let mime: String
        switch file.pathExtension.lowercased() {
        case "js", "mjs": mime = "text/javascript"
        case "css": mime = "text/css"
        case "json", "webmanifest": mime = "application/json"
        case "html": mime = "text/html"
        default: mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
        let response = URLResponse(url: url, mimeType: mime,
                                   expectedContentLength: data.count, textEncodingName: "utf-8")
        urlSchemeTask.didReceive(response)
        if urlSchemeTask.request.httpMethod != "HEAD" { urlSchemeTask.didReceive(data) }
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Local reads complete synchronously; no pending network task exists.
    }
}

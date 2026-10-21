import XCTest

final class ReleaseSmokeTests: XCTestCase {
    func testOfflineLaunchPrivacyAndBackgroundPause() {
        let app = XCUIApplication()
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launch()
        let launch = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH 'LAUNCH'")).firstMatch
        XCTAssertTrue(launch.waitForExistence(timeout: 45))
        XCTAssertGreaterThan(app.frame.width, app.frame.height)
        XCTAssertGreaterThan(app.webViews.firstMatch.frame.width, app.webViews.firstMatch.frame.height)
        let privacy = app.webViews.buttons["PRIVACY POLICY"].firstMatch
        XCTAssertTrue(privacy.exists)
        XCTAssertLessThanOrEqual(privacy.frame.maxY, app.frame.maxY - 20)
        privacy.tap()
        XCTAssertTrue(app.webViews.staticTexts["Joker's Run Privacy Policy"].waitForExistence(timeout: 5))
        app.webViews.buttons["Close privacy policy"].tap()
        let title = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        title.name = "offline-title"
        title.lifetime = .keepAlways
        add(title)
        launch.tap()
        sleep(3)
        let flight = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        flight.name = "mission-start"
        flight.lifetime = .keepAlways
        add(flight)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH 'RESUME'")).firstMatch.waitForExistence(timeout: 15))
        let paused = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        paused.name = "background-paused"
        paused.lifetime = .keepAlways
        add(paused)
        app.webViews.buttons["RESUME"].tap()
        XCTAssertFalse(app.webViews.buttons["RESUME"].isHittable)
    }
}

import Combine
import Foundation
import UIKit

/// User preferences, persisted in UserDefaults.
final class Settings: ObservableObject {
    static let speedPresets: [Double] = [150, 300, 600, 1200, 2400]

    @Published var sensitivity: Double { didSet { save(sensitivity, "sensitivity") } }
    @Published var acceleration: Double { didSet { save(acceleration, "acceleration") } }
    @Published var invertX: Bool { didSet { save(invertX, "invertX") } }
    @Published var invertY: Bool { didSet { save(invertY, "invertY") } }
    @Published var naturalScroll: Bool { didSet { save(naturalScroll, "naturalScroll") } }
    @Published var scrollSpeed: Double { didSet { save(scrollSpeed, "scrollSpeed") } }
    @Published var haptics: Bool { didSet { save(haptics, "haptics") } }
    @Published var leftHanded: Bool { didSet { save(leftHanded, "leftHanded") } }
    @Published var torch: Bool { didSet { save(torch, "torch") } }
    @Published var torchLevel: Double { didSet { save(torchLevel, "torchLevel") } }
    @Published var ultraWide: Bool { didSet { save(ultraWide, "ultraWide") } }

    private let defaults = UserDefaults.standard

    init() {
        let d = UserDefaults.standard
        d.register(defaults: [
            "sensitivity": 600.0, "acceleration": 0.6, "scrollSpeed": 1.0,
            "haptics": true, "torch": true, "torchLevel": 0.3,
        ])
        sensitivity = d.double(forKey: "sensitivity")
        acceleration = d.double(forKey: "acceleration")
        invertX = d.bool(forKey: "invertX")
        invertY = d.bool(forKey: "invertY")
        naturalScroll = d.bool(forKey: "naturalScroll")
        scrollSpeed = d.double(forKey: "scrollSpeed")
        haptics = d.bool(forKey: "haptics")
        leftHanded = d.bool(forKey: "leftHanded")
        torch = d.bool(forKey: "torch")
        torchLevel = d.double(forKey: "torchLevel")
        ultraWide = d.bool(forKey: "ultraWide")
    }

    private func save(_ value: Any, _ key: String) { defaults.set(value, forKey: key) }

    /// Index of the speed preset closest to the current sensitivity.
    var speedLevel: Int {
        var best = 0
        for (i, preset) in Settings.speedPresets.enumerated()
        where abs(log(preset / sensitivity)) < abs(log(Settings.speedPresets[best] / sensitivity)) { best = i }
        return best
    }

    func cycleSpeed() {
        sensitivity = Settings.speedPresets[(speedLevel + 1) % Settings.speedPresets.count]
    }
}

/// Live sensor read-out for the UI (updated ~20×/s, not per frame).
final class TrackingStats: ObservableObject {
    @Published var camera: CameraTracker.Status = .idle
    @Published var tracked = false
    @Published var quality = 0.0
    /// Recent cursor direction, each axis roughly −1…1, for the sensor display.
    @Published var vectorX = 0.0
    @Published var vectorY = 0.0
    @Published var fps = 0
}

final class AppModel: ObservableObject {
    let settings = Settings()
    let link = MouseLink()
    let browser = ServerBrowser()
    let stats = TrackingStats()
    private let tracker = CameraTracker()

    @Published var paused = false { didSet { syncConfig() } }

    private var bag = Set<AnyCancellable>()

    // Shared with the camera frame queue.
    private struct Config {
        var sensitivity = 600.0, acceleration = 0.6
        var invertX = false, invertY = false
        var sending = false
    }
    private let configLock = NSLock()
    private var config = Config()

    // Frame-queue state.
    private var mapper = PointerMapper()
    private var frames = 0
    private var windowStart = 0.0
    private var clock = 0.0
    private var lastPublish = 0.0
    private var smoothQuality = 0.0
    private var smoothX = 0.0, smoothY = 0.0
    private var trackedFrames = 0, publishFrames = 0

    private let clickDown = UIImpactFeedbackGenerator(style: .rigid)
    private let clickUp = UIImpactFeedbackGenerator(style: .light)
    private let notch = UISelectionFeedbackGenerator()

    init() {
        tracker.onStatus = { [weak self] status in self?.stats.camera = status }
        tracker.onMotion = { [weak self] sample, dt in self?.handle(sample, dt: dt) }

        settings.objectWillChange
            .merge(with: link.objectWillChange)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.syncConfig() }
            .store(in: &bag)
        syncConfig()
    }

    // MARK: - Lifecycle

    func activate() {
        UIApplication.shared.isIdleTimerDisabled = true
        tracker.start()
        browser.start()
        link.resume()
    }

    func deactivate() {
        UIApplication.shared.isIdleTimerDisabled = false
        tracker.stop()
        link.suspend()
    }

    func openSystemSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    }

    private func syncConfig() {
        configLock.lock()
        config.sensitivity = settings.sensitivity
        config.acceleration = settings.acceleration
        config.invertX = settings.invertX
        config.invertY = settings.invertY
        config.sending = link.isConnected && !paused
        configLock.unlock()
        tracker.setTorch(on: settings.torch && !paused, level: Float(settings.torchLevel))
        tracker.setLens(settings.ultraWide ? .ultraWide : .wide)
    }

    // MARK: - Motion (camera frame queue)

    private func handle(_ sample: MotionSample, dt: Double) {
        configLock.lock()
        let cfg = config
        configLock.unlock()

        mapper.sensitivity = cfg.sensitivity
        mapper.acceleration = cfg.acceleration
        mapper.invertX = cfg.invertX
        mapper.invertY = cfg.invertY
        let move = mapper.map(shiftX: sample.tracked ? sample.dx : 0, shiftY: sample.tracked ? sample.dy : 0, dt: dt)
        if cfg.sending, abs(move.dx) + abs(move.dy) > 0.0005 {
            link.sendMove(dx: move.dx, dy: move.dy)
        }

        // Read-out for the UI.
        clock += dt
        frames += 1
        publishFrames += 1
        if sample.tracked { trackedFrames += 1 }
        smoothQuality += 0.1 * (sample.quality - smoothQuality)
        let speedX = move.dx / max(dt, 0.001) / 900, speedY = move.dy / max(dt, 0.001) / 900
        smoothX += 0.25 * (max(-1, min(1, speedX)) - smoothX)
        smoothY += 0.25 * (max(-1, min(1, speedY)) - smoothY)

        if clock - lastPublish >= 0.05 {
            lastPublish = clock
            let tracked = trackedFrames * 2 > publishFrames
            trackedFrames = 0; publishFrames = 0
            var fps: Int?
            if clock - windowStart >= 1 {
                fps = Int((Double(frames) / (clock - windowStart)).rounded())
                frames = 0; windowStart = clock
            }
            let q = smoothQuality, vx = smoothX, vy = smoothY
            DispatchQueue.main.async {
                let s = self.stats
                if s.tracked != tracked { s.tracked = tracked }
                if abs(s.quality - q) > 0.02 { s.quality = q }
                if abs(s.vectorX - vx) > 0.01 || abs(s.vectorY - vy) > 0.01 { s.vectorX = vx; s.vectorY = vy }
                if let fps = fps, s.fps != fps { s.fps = fps }
            }
        }
    }

    // MARK: - Buttons & wheel (main thread)

    enum MouseButton { case primary, secondary, middle }

    func press(_ button: MouseButton, down: Bool) {
        let name: String
        switch button {
        case .primary: name = settings.leftHanded ? "r" : "l"
        case .secondary: name = settings.leftHanded ? "l" : "r"
        case .middle: name = "m"
        }
        link.sendButton(name, down: down)
        if settings.haptics {
            if down { clickDown.impactOccurred(intensity: 1.0) } else { clickUp.impactOccurred(intensity: 0.6) }
        }
    }

    /// `notches` > 0 means the wheel rolled away from the user.
    func scroll(notches: Double) {
        let direction = settings.naturalScroll ? -1.0 : 1.0
        link.sendScroll(dx: 0, dy: notches * direction * settings.scrollSpeed)
    }

    func wheelTick() {
        if settings.haptics { notch.selectionChanged() }
    }

    func tap() {
        if settings.haptics { clickUp.impactOccurred(intensity: 0.8) }
    }
}

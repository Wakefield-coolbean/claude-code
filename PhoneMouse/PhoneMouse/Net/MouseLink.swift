import Combine
import CryptoKit
import Foundation
import Network

/// A computer the app can connect to.
enum LinkTarget: Codable, Equatable, Hashable {
    case bonjour(name: String)
    case host(address: String, port: UInt16)

    static let serviceType = "_phonemouse._tcp"
    static let defaultPort: UInt16 = 47800

    var endpoint: NWEndpoint? {
        switch self {
        case .bonjour(let name):
            return .service(name: name, type: LinkTarget.serviceType, domain: "local.", interface: nil)
        case .host(let address, let port):
            guard let p = NWEndpoint.Port(rawValue: port) else { return nil }
            return .hostPort(host: NWEndpoint.Host(address), port: p)
        }
    }

    var title: String {
        switch self {
        case .bonjour(let name): return name
        case .host(let address, _): return address
        }
    }

    var key: String {
        switch self {
        case .bonjour(let name): return "b:" + name
        case .host(let address, let port): return "h:\(address):\(port)"
        }
    }
}

/// The connection to the desktop receiver. Text lines over TCP; see server/phonemouse_server.py.
final class MouseLink: ObservableObject {
    enum State: Equatable {
        case idle
        case connecting(String)
        case needsPIN(LinkTarget, wrong: Bool)
        case connected(String)
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var latencyMs: Double?

    var isConnected: Bool { if case .connected = state { return true } else { return false } }

    private let queue = DispatchQueue(label: "phonemouse.link")
    private let lock = NSLock()
    private var live: NWConnection?          // guarded by `lock`; set only once authenticated

    // Queue-confined.
    private var connection: NWConnection?
    private var generation = 0
    private var buffer = Data()
    private var target: LinkTarget?
    private var pin: String?
    private var authed = false
    private var lastPong = Date()
    private var timer: DispatchSourceTimer?
    private var keepAlive = false            // reconnect automatically when the link drops
    private var suspended = false

    private let defaults = UserDefaults.standard

    init() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 1, repeating: 1.0)
        t.setEventHandler { [weak self] in self?.tick() }
        t.resume()
        timer = t
    }

    // MARK: - Public API (main thread)

    var lastTarget: LinkTarget? {
        guard let data = defaults.data(forKey: "lastTarget") else { return nil }
        return try? JSONDecoder().decode(LinkTarget.self, from: data)
    }

    func connect(to target: LinkTarget, pin: String? = nil) {
        queue.async {
            self.keepAlive = true
            self.open(target, pin: pin)
        }
    }

    func disconnect() {
        queue.async {
            self.keepAlive = false
            self.close()
            self.publish(.idle)
        }
    }

    /// App went to the background: drop the link (the receiver releases any held buttons).
    func suspend() {
        queue.async {
            self.suspended = true
            self.close()
        }
    }

    /// App is back: reconnect to the last computer if we were connected before.
    func resume() {
        queue.async {
            self.suspended = false
            if self.connection == nil, let last = self.lastTarget, self.defaults.bool(forKey: "autoConnect") {
                self.keepAlive = true
                self.open(last, pin: nil)
            }
        }
    }

    // MARK: - Sending (any thread)

    func sendMove(dx: Double, dy: Double) {
        send(String(format: "M %.3f %.3f\n", dx, dy))
    }

    func sendButton(_ name: String, down: Bool) {
        send("B \(name) \(down ? 1 : 0)\n")
    }

    func sendScroll(dx: Double, dy: Double) {
        send(String(format: "S %.3f %.3f\n", dx, dy))
    }

    private func send(_ line: String) {
        lock.lock()
        let conn = live
        lock.unlock()
        conn?.send(content: line.data(using: .utf8), completion: .contentProcessed { _ in })
    }

    // MARK: - Connection lifecycle (link queue)

    private func publish(_ newState: State) {
        DispatchQueue.main.async {
            if self.state != newState { self.state = newState }
            if case .connected = newState {} else { self.latencyMs = nil }
        }
    }

    private func setLive(_ conn: NWConnection?) {
        lock.lock()
        live = conn
        lock.unlock()
    }

    private func close() {
        generation += 1
        setLive(nil)
        connection?.cancel()
        connection = nil
        authed = false
        buffer.removeAll()
    }

    private func open(_ newTarget: LinkTarget, pin newPin: String?) {
        close()
        guard let endpoint = newTarget.endpoint else {
            publish(.failed("That address doesn't look right"))
            keepAlive = false
            return
        }
        target = newTarget
        pin = newPin ?? storedPIN(for: newTarget)
        lastPong = Date()
        publish(.connecting(newTarget.title))

        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        tcp.connectionTimeout = 6
        let conn = NWConnection(to: endpoint, using: NWParameters(tls: nil, tcp: tcp))
        connection = conn
        let gen = generation
        conn.stateUpdateHandler = { [weak self] newState in
            guard let self = self, gen == self.generation else { return }
            switch newState {
            case .ready:
                self.lastPong = Date()
                self.receive(on: conn, generation: gen)
            case .failed(let error):
                self.dropped("Couldn't reach \(newTarget.title) (\(error.localizedDescription))")
            case .waiting:
                // No route yet (Wi-Fi off, receiver not running…). Treat as a failed attempt.
                self.dropped("Can't find \(newTarget.title). Is the receiver running?")
            default:
                break
            }
        }
        conn.start(queue: queue)
    }

    private func dropped(_ message: String) {
        close()
        publish(.failed(message))
    }

    private func receive(on conn: NWConnection, generation gen: Int) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, isComplete, error in
            guard let self = self, gen == self.generation else { return }
            if let data = data, !data.isEmpty {
                self.buffer.append(data)
                while let newline = self.buffer.firstIndex(of: 0x0A) {
                    let lineData = self.buffer.subdata(in: self.buffer.startIndex..<newline)
                    self.buffer.removeSubrange(self.buffer.startIndex...newline)
                    if let line = String(data: lineData, encoding: .utf8) {
                        self.handle(line.trimmingCharacters(in: .whitespacesAndNewlines), on: conn)
                        if gen != self.generation { return }
                    }
                }
                if self.buffer.count > 4096 { self.buffer.removeAll() }
            }
            if isComplete || error != nil {
                self.dropped("Connection closed")
                return
            }
            self.receive(on: conn, generation: gen)
        }
    }

    private func handle(_ line: String, on conn: NWConnection) {
        guard let target = target else { return }
        let parts = line.split(separator: " ", maxSplits: 2).map(String.init)
        guard let kind = parts.first else { return }

        if !authed {
            switch kind {
            case "PM1" where parts.count >= 2:
                guard let pin = pin, !pin.isEmpty else {
                    close()
                    keepAlive = false
                    publish(.needsPIN(target, wrong: false))
                    return
                }
                let key = SymmetricKey(data: Data(pin.utf8))
                let mac = HMAC<SHA256>.authenticationCode(for: Data(parts[1].utf8), using: key)
                let hex = mac.map { String(format: "%02x", $0) }.joined()
                conn.send(content: "A \(hex)\n".data(using: .utf8), completion: .contentProcessed { _ in })
            case "OK":
                authed = true
                lastPong = Date()
                if let pin = pin { storePIN(pin, for: target) }
                if let data = try? JSONEncoder().encode(target) { defaults.set(data, forKey: "lastTarget") }
                defaults.set(true, forKey: "autoConnect")
                setLive(conn)
                publish(.connected(target.title))
            case "NO":
                let wrongPIN = parts.count > 1 && parts[1] == "bad-pin"
                close()
                keepAlive = false
                if wrongPIN {
                    storePIN(nil, for: target)
                    publish(.needsPIN(target, wrong: true))
                } else {
                    publish(.failed("Too many wrong PINs. Wait 30 seconds and try again."))
                }
            default:
                break
            }
            return
        }

        if kind == "P", parts.count >= 2, let sent = Double(parts[1]) {
            lastPong = Date()
            let ms = max(0, Date().timeIntervalSince1970 * 1000 - sent)
            DispatchQueue.main.async { self.latencyMs = ms }
        }
    }

    private func tick() {
        if authed, let conn = connection {
            if Date().timeIntervalSince(lastPong) > 5 {
                dropped("Lost contact with the computer")
                return
            }
            let stamp = String(format: "P %.1f\n", Date().timeIntervalSince1970 * 1000)
            conn.send(content: stamp.data(using: .utf8), completion: .contentProcessed { _ in })
        } else if connection == nil, keepAlive, !suspended, let target = target {
            open(target, pin: nil)      // quiet retry once a second until the receiver is back
        } else if connection != nil, !authed, Date().timeIntervalSince(lastPong) > 8 {
            dropped("The computer didn't answer")
        }
    }

    // MARK: - PIN storage

    private func storedPIN(for target: LinkTarget) -> String? {
        (defaults.dictionary(forKey: "pins") as? [String: String])?[target.key]
    }

    private func storePIN(_ pin: String?, for target: LinkTarget) {
        var pins = (defaults.dictionary(forKey: "pins") as? [String: String]) ?? [:]
        pins[target.key] = pin
        defaults.set(pins, forKey: "pins")
    }
}

/// Finds receivers advertising themselves on the local network.
final class ServerBrowser: ObservableObject {
    @Published private(set) var servers: [String] = []
    private var browser: NWBrowser?

    func start() {
        guard browser == nil else { return }
        let b = NWBrowser(for: .bonjour(type: LinkTarget.serviceType, domain: nil), using: .tcp)
        b.browseResultsChangedHandler = { [weak self] results, _ in
            var names: [String] = []
            for result in results {
                if case let .service(name, _, _, _) = result.endpoint, !names.contains(name) { names.append(name) }
            }
            names.sort()
            DispatchQueue.main.async { self?.servers = names }
        }
        b.start(queue: DispatchQueue(label: "phonemouse.browser"))
        browser = b
    }

    func stop() {
        browser?.cancel()
        browser = nil
    }
}

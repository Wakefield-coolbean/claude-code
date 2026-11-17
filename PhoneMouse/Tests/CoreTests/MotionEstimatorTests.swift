import XCTest
@testable import PhoneMouseCore

/// Deterministic generator so the tests are reproducible.
private struct LCG {
    var state: UInt64
    mutating func next() -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return Double(state >> 11) / Double(1 << 53)
    }
    mutating func gaussian() -> Double {
        var s = 0.0
        for _ in 0..<6 { s += next() }
        return (s - 3.0) * 1.4142
    }
}

/// A big synthetic surface rendered at 8× the sensor resolution, so the camera can be
/// positioned in 1/8-pixel steps.
private final class Surface {
    static let scale = 8
    let size: Int
    var data: [Float]

    init(size: Int, seed: UInt64, pattern: (Int, Int, inout LCG) -> Float? = { _, _, _ in nil }) {
        self.size = size
        var rng = LCG(state: seed)
        data = [Float](repeating: 0, count: size * size)
        // Blocky multi-scale noise.
        for cell in [8, 24, 64] {
            let cells = size / cell + 2
            var values = [Float](repeating: 0, count: cells * cells)
            for i in 0..<values.count { values[i] = Float(rng.gaussian()) }
            for y in 0..<size {
                for x in 0..<size { data[y * size + x] += values[(y / cell) * cells + x / cell] * 14 }
            }
        }
        for y in 0..<size {
            for x in 0..<size {
                if let v = pattern(x, y, &rng) { data[y * size + x] = v } else { data[y * size + x] += 128 }
            }
        }
    }

    /// The 64×64 frame a camera at (cx, cy) sensor pixels would see, with sensor noise.
    func frame(cx: Double, cy: Double, noise: Double, rng: inout LCG) -> [UInt16] {
        let n = MotionEstimator.size, s = Surface.scale
        let ox = Int((cx * Double(s)).rounded()), oy = Int((cy * Double(s)).rounded())
        var out = [UInt16](repeating: 0, count: n * n)
        for y in 0..<n {
            for x in 0..<n {
                var sum: Float = 0
                for yy in 0..<s {
                    let row = (oy + y * s + yy) * size + ox + x * s
                    for xx in 0..<s { sum += data[row + xx] }
                }
                let luma = Double(sum) / Double(s * s) + rng.gaussian() * noise
                out[y * n + x] = UInt16(max(0, min(2040, (luma * 8).rounded())))
            }
        }
        return out
    }
}

final class MotionEstimatorTests: XCTestCase {

    /// Moves a virtual camera along `path` and returns the summed measured content shift.
    private func track(_ surface: Surface, path: [(Double, Double)], noise: Double = 1.0)
        -> (x: Double, y: Double, lost: Int) {
        let estimator = MotionEstimator()
        var rng = LCG(state: 99)
        var sx = 0.0, sy = 0.0, lost = 0
        for (i, p) in path.enumerated() {
            let frame = surface.frame(cx: p.0, cy: p.1, noise: noise, rng: &rng)
            let sample = frame.withUnsafeBufferPointer { estimator.process($0) }
            sx += sample.dx; sy += sample.dy
            if i > 0 && !sample.tracked { lost += 1 }
        }
        return (sx, sy, lost)
    }

    private func line(_ count: Int, _ vx: Double, _ vy: Double, from start: (Double, Double) = (120, 120)) -> [(Double, Double)] {
        (0..<count).map { (start.0 + vx * Double($0), start.1 + vy * Double($0)) }
    }

    private lazy var textured = Surface(size: 3600, seed: 7)

    func testSlowDriftIsNotRoundedAway() {
        // 1/8 px per frame: far below one pixel, must still add up.
        let r = track(textured, path: line(200, 0.125, 0))
        XCTAssertEqual(r.x, -24.875, accuracy: 0.6)   // camera +x → content −x
        XCTAssertEqual(r.y, 0, accuracy: 0.6)
        XCTAssertEqual(r.lost, 0)
    }

    func testMediumDiagonal() {
        let r = track(textured, path: line(100, 2.375, 1.125))
        XCTAssertEqual(r.x, -235.1, accuracy: 3)
        XCTAssertEqual(r.y, -111.4, accuracy: 3)
        XCTAssertEqual(r.lost, 0)
    }

    func testFastMotion() {
        let r = track(textured, path: line(30, 9.5, -6.25, from: (40, 260)))
        XCTAssertEqual(r.x, -275.5, accuracy: 4)
        XCTAssertEqual(r.y, 181.25, accuracy: 4)
        XCTAssertEqual(r.lost, 0)
    }

    func testCircleReturnsToStart() {
        let path = (0...240).map { i -> (Double, Double) in
            let a = 2 * Double.pi * Double(i) / 120
            return (200 + 20 * cos(a), 200 + 20 * sin(a))
        }
        let r = track(textured, path: path)
        XCTAssertEqual(r.x, 0, accuracy: 1.5)
        XCTAssertEqual(r.y, 0, accuracy: 1.5)
    }

    func testStationaryDoesNotCreep() {
        let r = track(textured, path: line(200, 0, 0), noise: 2.0)
        XCTAssertEqual(r.x, 0, accuracy: 0.2)
        XCTAssertEqual(r.y, 0, accuracy: 0.2)
    }

    func testNoiseOnlyIsRejected() {
        let estimator = MotionEstimator()
        var rng = LCG(state: 5)
        var tracked = 0, moved = 0.0
        for _ in 0..<200 {
            var frame = [UInt16](repeating: 0, count: 64 * 64)
            for i in 0..<frame.count { frame[i] = UInt16(max(0, (120 + rng.gaussian() * 1.5) * 8)) }
            let s = frame.withUnsafeBufferPointer { estimator.process($0) }
            if s.tracked { tracked += 1 }
            moved += abs(s.dx) + abs(s.dy)
        }
        XCTAssertEqual(tracked, 0)
        XCTAssertEqual(moved, 0)
    }

    func testPeriodicMeshDoesNotAlias() {
        // 9 px mesh: look-alike matches every half period.
        let mesh = Surface(size: 3600, seed: 3) { x, y, _ in
            Float(128 + 30 * sin(Double(x) * 2 * Double.pi / 72) * sin(Double(y) * 2 * Double.pi / 72))
        }
        let r = track(mesh, path: line(80, 3.1, 1.7, from: (60, 60)), noise: 0.8)
        XCTAssertEqual(r.x, -244.9, accuracy: 3)
        XCTAssertEqual(r.y, -134.3, accuracy: 3)
    }

    func testStripesOnlyReportObservableAxis() {
        // Texture varies with y only: x motion can't be seen and must not turn into jitter.
        var rows = [Float](repeating: 0, count: 3600)
        var rng = LCG(state: 11)
        for i in 0..<rows.count { rows[i] = Float(rng.gaussian()) }
        for _ in 0..<30 {
            var next = rows
            for i in 1..<(rows.count - 1) { next[i] = 0.25 * rows[i - 1] + 0.5 * rows[i] + 0.25 * rows[i + 1] }
            rows = next
        }
        let peak = rows.map { abs($0) }.max() ?? 1
        let stripes = Surface(size: 3600, seed: 3) { _, y, _ in 128 + 60 * rows[y] / peak }
        let r = track(stripes, path: line(200, 0.7, 0.4), noise: 0.8)
        XCTAssertEqual(r.y, -79.6, accuracy: 2)
        XCTAssertEqual(r.x, 0, accuracy: 2)
    }
}

final class PointerMapperTests: XCTestCase {
    func testAxisConvention() {
        // Phone moving right shifts content toward buffer +y → cursor must go right (+x).
        var m = PointerMapper(); m.acceleration = 0
        var total = (0.0, 0.0)
        for _ in 0..<120 { let d = m.map(shiftX: 0, shiftY: 0.5, dt: 1.0 / 120); total.0 += d.dx; total.1 += d.dy }
        XCTAssertGreaterThan(total.0, 0); XCTAssertEqual(total.1, 0, accuracy: 1e-9)

        // Phone moving forward shifts content toward buffer +x → cursor must go up (−y).
        m.reset(); total = (0, 0)
        for _ in 0..<120 { let d = m.map(shiftX: 0.5, shiftY: 0, dt: 1.0 / 120); total.0 += d.dx; total.1 += d.dy }
        XCTAssertLessThan(total.1, 0); XCTAssertEqual(total.0, 0, accuracy: 1e-9)
    }

    func testDistanceIsPreservedWithoutAcceleration() {
        var m = PointerMapper(); m.acceleration = 0; m.sensitivity = 640
        var x = 0.0
        for _ in 0..<240 { x += m.map(shiftX: 0, shiftY: 0.25, dt: 1.0 / 120).dx }
        for _ in 0..<240 { x += m.map(shiftX: 0, shiftY: 0, dt: 1.0 / 120).dx }   // let the filter settle
        XCTAssertEqual(x, 240 * 0.25 / 64 * 640, accuracy: 1.0)
    }

    func testInvertAndAcceleration() {
        var m = PointerMapper(); m.invertX = true
        XCTAssertLessThan((0..<60).reduce(0.0) { a, _ in a + m.map(shiftX: 0, shiftY: 1, dt: 1.0 / 120).dx }, 0)

        var slow = PointerMapper(), fast = PointerMapper()
        slow.acceleration = 0; fast.acceleration = 1
        var a = 0.0, b = 0.0
        for _ in 0..<120 { a += slow.map(shiftX: 0, shiftY: 4, dt: 1.0 / 120).dx; b += fast.map(shiftX: 0, shiftY: 4, dt: 1.0 / 120).dx }
        XCTAssertGreaterThan(b, a * 1.2)
    }
}

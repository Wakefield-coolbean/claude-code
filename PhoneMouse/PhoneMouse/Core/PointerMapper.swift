import Foundation

/// Turns image motion from the back camera into cursor motion.
///
/// Camera buffers arrive in the sensor's native landscape orientation. With the phone lying
/// screen-up (or held upright), buffer +x points toward the phone's bottom edge and buffer +y
/// toward its left edge. The scene appears to move opposite to the phone, so:
///   phone moves right   → content shifts +y → cursor right
///   phone moves forward → content shifts +x → cursor up
public struct PointerMapper {
    /// Cursor pixels for a movement that shifts the view by one full frame.
    public var sensitivity = 600.0
    /// 0 = linear; higher = fast flicks travel further.
    public var acceleration = 0.6
    public var invertX = false
    public var invertY = false

    private var filterX = OneEuroFilter()
    private var filterY = OneEuroFilter()
    private var posX = 0.0, posY = 0.0
    private var lastX = 0.0, lastY = 0.0

    public init() {}

    public mutating func reset() {
        filterX.reset(); filterY.reset()
        posX = 0; posY = 0; lastX = 0; lastY = 0
    }

    /// - Parameters: content shift in sensor-grid pixels, and seconds since the previous frame.
    /// - Returns: cursor delta in screen pixels (x right, y down).
    public mutating func map(shiftX: Double, shiftY: Double, dt: Double) -> (dx: Double, dy: Double) {
        let unit = Double(MotionEstimator.size)
        posX += shiftY / unit
        posY += -shiftX / unit
        let step = dt > 0 ? dt : 1.0 / 60.0
        let fx = filterX.filter(posX, dt: step)
        let fy = filterY.filter(posY, dt: step)
        let dx = fx - lastX, dy = fy - lastY
        lastX = fx; lastY = fy

        let speed = (dx * dx + dy * dy).squareRoot() / step * sensitivity   // cursor px/s before boost
        let gain = sensitivity * (1 + acceleration * min(speed / 1500, 2))
        return ((invertX ? -dx : dx) * gain, (invertY ? -dy : dy) * gain)
    }
}

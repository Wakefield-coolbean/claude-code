import Foundation

/// 1€ filter: heavy smoothing when nearly still (kills jitter), light smoothing when moving (no lag).
public struct OneEuroFilter {
    public var minCutoff: Double
    public var beta: Double
    public var derivativeCutoff: Double

    private var value: Double?
    private var derivative = 0.0

    public init(minCutoff: Double = 3.0, beta: Double = 40.0, derivativeCutoff: Double = 1.5) {
        self.minCutoff = minCutoff; self.beta = beta; self.derivativeCutoff = derivativeCutoff
    }

    public mutating func reset() { value = nil; derivative = 0 }

    public mutating func filter(_ x: Double, dt: Double) -> Double {
        guard let previous = value, dt > 0 else { value = x; return x }
        let rawDerivative = (x - previous) / dt
        derivative += OneEuroFilter.alpha(cutoff: derivativeCutoff, dt: dt) * (rawDerivative - derivative)
        let cutoff = minCutoff + beta * abs(derivative)
        let result = previous + OneEuroFilter.alpha(cutoff: cutoff, dt: dt) * (x - previous)
        value = result
        return result
    }

    private static func alpha(cutoff: Double, dt: Double) -> Double {
        let tau = 1.0 / (2 * Double.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)
    }
}

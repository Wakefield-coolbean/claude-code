import Foundation

/// One frame's worth of measured image motion.
public struct MotionSample {
    /// How far the scene content moved since the previous frame, in sensor-grid pixels.
    public var dx: Double
    public var dy: Double
    /// 0 (no usable match) … 1 (perfect match).
    public var quality: Double
    public var tracked: Bool

    public init(dx: Double, dy: Double, quality: Double, tracked: Bool) {
        self.dx = dx; self.dy = dy; self.quality = quality; self.tracked = tracked
    }
}

/// Optical-mouse style motion sensor.
///
/// Each frame is a 64×64 luma grid. The estimator keeps a reference frame and finds where its
/// centre window reappears in the new frame (sum of squared differences over a ±16 px search),
/// refines that to sub-pixel precision, and reports the change since the previous frame.
/// Matching against a held reference (instead of frame-to-frame) is what lets very slow
/// movement accumulate instead of being rounded away.
public final class MotionEstimator {
    public static let size = 64
    public static let radius = 16

    private let n = MotionEstimator.size
    private let r = MotionEstimator.radius
    private let w = MotionEstimator.size - 2 * MotionEstimator.radius
    private let side = 2 * MotionEstimator.radius + 1

    // Tuning (validated against synthetic surfaces: sharp, blurred, noisy, striped, periodic).
    private let highPassRadius = 6
    private let minEnergyPerPixel = 16.0      // (0.5 luma levels × 8)²
    private let maxResidual = 0.5             // normalised match residual above this = lost
    private let selectionPrior = 0.3          // picks between look-alike matches (periodic surfaces)
    private let fitPrior = 0.05               // steadies the sub-pixel fit on featureless axes
    private let velocityCarry = 0.5
    private let refreshDistance = 4.0
    private let anisotropyLimit = 0.03

    private var ref: [Int32]
    private var cur: [Int32]
    private var smooth: [Int32]
    private var integral: [Int32]
    private var ssd: [Double]

    private var hasRef = false
    private var refEnergy = 0.0
    private var axis: (x: Double, y: Double)?
    private var lastX = 0.0, lastY = 0.0
    private var velX = 0.0, velY = 0.0

    public init() {
        ref = [Int32](repeating: 0, count: n * n)
        cur = ref
        smooth = ref
        integral = [Int32](repeating: 0, count: (n + 1) * (n + 1))
        ssd = [Double](repeating: 0, count: side * side)
    }

    public func reset() {
        hasRef = false
        velX = 0; velY = 0
    }

    /// `frame` holds `size*size` values, row-major, each = luma × 8 (0…2040).
    public func process(_ frame: UnsafeBufferPointer<UInt16>) -> MotionSample {
        precondition(frame.count >= n * n)
        prepare(frame)

        guard hasRef else {
            adoptReference()
            return MotionSample(dx: 0, dy: 0, quality: 0, tracked: false)
        }
        if refEnergy < minEnergyPerPixel * Double(w * w) {
            return lose(quality: 0)
        }

        computeSSD()

        let predX = lastX + velocityCarry * velX
        let predY = lastY + velocityCarry * velY
        let pSel = selectionPrior * refEnergy / Double(r * r)
        let pFit = fitPrior * refEnergy / Double(r * r)

        var bestCost = Double.infinity
        var bestIX = -1, bestIY = -1
        var bestVal = 0.0
        for iy in 1..<(side - 1) {
            for ix in 1..<(side - 1) {
                let b = ssd[iy * side + ix]
                let a = ssd[iy * side + ix - 1], c = ssd[iy * side + ix + 1]
                let u = ssd[(iy - 1) * side + ix], d = ssd[(iy + 1) * side + ix]
                if b > a || b > c || b > u || b > d { continue }
                let dxx = a - 2 * b + c, dyy = u - 2 * b + d
                let fx = dxx > 0 ? clampHalf(0.5 * (a - c) / dxx) : 0
                let fy = dyy > 0 ? clampHalf(0.5 * (u - d) / dyy) : 0
                var val = b
                if dxx > 0 { val -= 0.5 * dxx * fx * fx }
                if dyy > 0 { val -= 0.5 * dyy * fy * fy }
                if val < 0 { val = 0 }
                let sx = Double(ix - r) + fx, sy = Double(iy - r) + fy
                let cost = val + pSel * ((sx - predX) * (sx - predX) + (sy - predY) * (sy - predY))
                if cost < bestCost {
                    bestCost = cost; bestIX = ix; bestIY = iy; bestVal = val
                }
            }
        }
        guard bestIX >= 0 else { return lose(quality: 0) }

        let bx = bestIX - r, by = bestIY - r
        let curEnergy = windowEnergy(cur, offsetX: r + bx, offsetY: r + by)
        let residual = bestVal / max(refEnergy + curEnergy, 1e-9)
        let quality = max(0, min(1, 1 - residual / maxResidual))
        if residual > maxResidual { return lose(quality: 0) }

        func fit(_ a0: Double, _ b0: Double, _ c0: Double, _ i: Double, _ p: Double) -> Double {
            let a = a0 + pFit * (i - 1 - p) * (i - 1 - p)
            let b = b0 + pFit * (i - p) * (i - p)
            let c = c0 + pFit * (i + 1 - p) * (i + 1 - p)
            let d = a - 2 * b + c
            return d > 0 ? clampHalf(0.5 * (a - c) / d) : 0
        }
        let centre = ssd[bestIY * side + bestIX]
        let fx = fit(ssd[bestIY * side + bestIX - 1], centre, ssd[bestIY * side + bestIX + 1], Double(bx), predX)
        let fy = fit(ssd[(bestIY - 1) * side + bestIX], centre, ssd[(bestIY + 1) * side + bestIX], Double(by), predY)
        let dispX = Double(bx) + fx, dispY = Double(by) + fy

        var outX = dispX - lastX, outY = dispY - lastY
        if let axis = axis {
            // Texture only varies along one direction (wood grain, stripes): motion along the
            // stripes is unobservable, so keep only the component we can actually see.
            let p = outX * axis.x + outY * axis.y
            outX = p * axis.x; outY = p * axis.y
        }
        velX = outX; velY = outY

        if max(abs(dispX), abs(dispY)) >= refreshDistance {
            adoptReference()
        } else {
            lastX = dispX; lastY = dispY
        }
        return MotionSample(dx: outX, dy: outY, quality: quality, tracked: true)
    }

    // MARK: - Internals

    private func clampHalf(_ v: Double) -> Double { max(-0.5, min(0.5, v)) }

    private func lose(quality: Double) -> MotionSample {
        adoptReference()
        velX = 0; velY = 0
        return MotionSample(dx: 0, dy: 0, quality: quality, tracked: false)
    }

    /// 3×3 binomial smoothing, then subtract a local box mean (removes lighting gradients).
    private func prepare(_ frame: UnsafeBufferPointer<UInt16>) {
        let n = self.n
        // Smooth: result = Σ kernel × value / 16, rounded.
        for y in 0..<n {
            let y0 = max(y - 1, 0), y2 = min(y + 1, n - 1)
            for x in 0..<n {
                let x0 = max(x - 1, 0), x2 = min(x + 1, n - 1)
                let top = Int32(frame[y0 * n + x0]) + 2 * Int32(frame[y0 * n + x]) + Int32(frame[y0 * n + x2])
                let mid = Int32(frame[y * n + x0]) + 2 * Int32(frame[y * n + x]) + Int32(frame[y * n + x2])
                let bot = Int32(frame[y2 * n + x0]) + 2 * Int32(frame[y2 * n + x]) + Int32(frame[y2 * n + x2])
                smooth[y * n + x] = (top + 2 * mid + bot + 8) >> 4
            }
        }
        // Integral image.
        let m = n + 1
        for y in 0..<n {
            var row: Int32 = 0
            for x in 0..<n {
                row += smooth[y * n + x]
                integral[(y + 1) * m + x + 1] = integral[y * m + x + 1] + row
            }
        }
        let br = highPassRadius
        for y in 0..<n {
            let y0 = max(y - br, 0), y1 = min(y + br + 1, n)
            for x in 0..<n {
                let x0 = max(x - br, 0), x1 = min(x + br + 1, n)
                let sum = integral[y1 * m + x1] - integral[y0 * m + x1] - integral[y1 * m + x0] + integral[y0 * m + x0]
                let count = Int32((y1 - y0) * (x1 - x0))
                cur[y * n + x] = smooth[y * n + x] - sum / count
            }
        }
    }

    private func windowEnergy(_ img: [Int32], offsetX: Int, offsetY: Int) -> Double {
        var total: Int64 = 0
        for y in 0..<w {
            let base = (offsetY + y) * n + offsetX
            var row: Int64 = 0
            for x in 0..<w {
                let v = Int64(img[base + x])
                row += v * v
            }
            total += row
        }
        return Double(total)
    }

    private func adoptReference() {
        swap(&ref, &cur)
        hasRef = true
        lastX = 0; lastY = 0
        refEnergy = windowEnergy(ref, offsetX: r, offsetY: r)

        // Structure tensor of the reference window → is the texture one-directional?
        var a = 0.0, b = 0.0, c = 0.0
        for y in 0..<w {
            let row = (r + y) * n + r
            for x in 0..<w {
                let gx = Double(ref[row + x + 1] - ref[row + x - 1]) * 0.5
                let gy = Double(ref[row + x + n] - ref[row + x - n]) * 0.5
                a += gx * gx; b += gx * gy; c += gy * gy
            }
        }
        let tr = a + c, det = a * c - b * b
        let disc = (max(tr * tr / 4 - det, 0)).squareRoot()
        let l1 = tr / 2 + disc, l2 = tr / 2 - disc
        axis = nil
        if l1 > 0, l2 < anisotropyLimit * l1 {
            var vx: Double, vy: Double
            if abs(b) > 1e-9 * l1 { vx = l1 - c; vy = b } else if a >= c { vx = 1; vy = 0 } else { vx = 0; vy = 1 }
            let len = (vx * vx + vy * vy).squareRoot()
            if len > 0 { vx /= len; vy /= len; axis = (vx, vy) }
        }
    }

    private func computeSSD() {
        let n = self.n, r = self.r, w = self.w, side = self.side
        ref.withUnsafeBufferPointer { rp in
            cur.withUnsafeBufferPointer { cp in
                ssd.withUnsafeMutableBufferPointer { out in
                    guard let rb = rp.baseAddress, let cb = cp.baseAddress else { return }
                    for sy in -r...r {
                        for sx in -r...r {
                            var total: Int64 = 0
                            for y in 0..<w {
                                let a = rb + (r + y) * n + r
                                let b = cb + (r + y + sy) * n + r + sx
                                var row: Int32 = 0
                                for x in 0..<w {
                                    let d = a[x] &- b[x]
                                    row = row &+ d &* d
                                }
                                total += Int64(row)
                            }
                            out[(sy + r) * side + sx + r] = Double(total)
                        }
                    }
                }
            }
        }
    }
}

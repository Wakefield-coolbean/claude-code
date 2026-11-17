import AVFoundation
import CoreVideo
import Foundation

/// Runs the back camera at a high frame rate and feeds a tiny luma grid to the motion estimator.
final class CameraTracker: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    enum Status: Equatable { case idle, running, denied, unavailable }
    enum Lens: String { case wide, ultraWide }

    /// Called on the frame queue for every frame: (motion, seconds since previous frame).
    var onMotion: ((MotionSample, Double) -> Void)?
    /// Called on the main queue.
    var onStatus: ((Status) -> Void)?

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "phonemouse.camera.session")
    private let frameQueue = DispatchQueue(label: "phonemouse.camera.frames", qos: .userInteractive)
    private let estimator = MotionEstimator()

    // Session-queue state.
    private var device: AVCaptureDevice?
    private var configuredLens: Lens?
    private var wantsRunning = false
    private var lens: Lens = .wide
    private var torchOn = true
    private var torchLevel: Float = 0.3

    // Frame-queue state.
    private var grid = [UInt16](repeating: 0, count: MotionEstimator.size * MotionEstimator.size)
    private var lastTimestamp: Double?

    func start() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            beginRunning()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                if granted { self?.beginRunning() } else { self?.report(.denied) }
            }
        default:
            report(.denied)
        }
    }

    func stop() {
        sessionQueue.async {
            self.wantsRunning = false
            if self.session.isRunning { self.session.stopRunning() }
            self.report(.idle)
        }
    }

    func setTorch(on: Bool, level: Float) {
        sessionQueue.async {
            self.torchOn = on
            self.torchLevel = level
            self.applyTorch()
        }
    }

    func setLens(_ newLens: Lens) {
        sessionQueue.async {
            guard newLens != self.lens else { return }
            self.lens = newLens
            if self.wantsRunning {
                self.configure()
                self.applyTorch()
            }
        }
    }

    // MARK: - Session

    private func report(_ status: Status) {
        DispatchQueue.main.async { self.onStatus?(status) }
    }

    private func beginRunning() {
        sessionQueue.async {
            self.wantsRunning = true
            if self.configuredLens != self.lens || self.device == nil {
                guard self.configure() else { self.report(.unavailable); return }
            }
            if !self.session.isRunning { self.session.startRunning() }
            self.frameQueue.async {
                self.estimator.reset()
                self.lastTimestamp = nil
            }
            self.applyTorch()
            self.report(self.session.isRunning ? .running : .unavailable)
        }
    }

    @discardableResult
    private func configure() -> Bool {
        let type: AVCaptureDevice.DeviceType = lens == .ultraWide ? .builtInUltraWideCamera : .builtInWideAngleCamera
        guard let camera = AVCaptureDevice.default(type, for: .video, position: .back)
                ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: camera) else { return false }

        session.beginConfiguration()
        session.sessionPreset = .inputPriority
        for old in session.inputs { session.removeInput(old) }
        for old in session.outputs { session.removeOutput(old) }
        guard session.canAddInput(input) else { session.commitConfiguration(); return false }
        session.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String:
                                    Int(kCVPixelFormatType_420YpCbCr8BiPlanarFullRange)]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: frameQueue)
        guard session.canAddOutput(output) else { session.commitConfiguration(); return false }
        session.addOutput(output)
        session.commitConfiguration()

        // Fastest frame rate available (up to 120 fps), at the smallest resolution that offers it:
        // more frames per second = faster hand movements stay trackable.
        var best: (format: AVCaptureDevice.Format, fps: Double, pixels: Int)?
        for format in camera.formats {
            let subtype = CMFormatDescriptionGetMediaSubType(format.formatDescription)
            guard subtype == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
                    || subtype == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange else { continue }
            let dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            guard dims.width >= 480, dims.height >= 360 else { continue }
            let maxRate = format.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 0
            let fps = min(maxRate, 120)
            let pixels = Int(dims.width) * Int(dims.height)
            if best == nil || fps > best!.fps + 0.5 || (abs(fps - best!.fps) <= 0.5 && pixels < best!.pixels) {
                best = (format, fps, pixels)
            }
        }

        do {
            try camera.lockForConfiguration()
            if let best = best, best.fps >= 1 {
                camera.activeFormat = best.format
                let duration = CMTime(value: 1, timescale: CMTimeScale(best.fps.rounded()))
                camera.activeVideoMinFrameDuration = duration
                camera.activeVideoMaxFrameDuration = duration
            }
            // Closest possible focus, locked: the surface is right under the lens and autofocus
            // hunting would read as motion.
            if camera.isLockingFocusWithCustomLensPositionSupported {
                camera.setFocusModeLocked(lensPosition: 0, completionHandler: nil)
            } else if camera.isFocusModeSupported(.continuousAutoFocus) {
                camera.focusMode = .continuousAutoFocus
            }
            if camera.isExposureModeSupported(.continuousAutoExposure) {
                camera.exposureMode = .continuousAutoExposure
            }
            // Short exposures keep moving frames sharp.
            let cap = CMTime(value: 1, timescale: 200)
            let format = camera.activeFormat
            if CMTimeCompare(cap, format.minExposureDuration) >= 0, CMTimeCompare(cap, format.maxExposureDuration) <= 0 {
                camera.activeMaxExposureDuration = cap
            }
            camera.unlockForConfiguration()
        } catch {
            return false
        }

        device = camera
        configuredLens = lens
        return true
    }

    private func applyTorch() {
        guard let camera = device, camera.hasTorch else { return }
        do {
            try camera.lockForConfiguration()
            if torchOn && wantsRunning && camera.isTorchAvailable {
                try camera.setTorchModeOn(level: max(0.02, min(torchLevel, AVCaptureDevice.maxAvailableTorchLevel)))
            } else if camera.torchMode != .off {
                camera.torchMode = .off
            }
            camera.unlockForConfiguration()
        } catch {
            // Torch can be refused when the phone is hot; tracking simply continues without it.
        }
    }

    // MARK: - Frames

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let timestamp = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))

        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard CVPixelBufferGetPlaneCount(pixelBuffer) >= 1,
              let base = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0) else { return }
        let width = CVPixelBufferGetWidthOfPlane(pixelBuffer, 0)
        let height = CVPixelBufferGetHeightOfPlane(pixelBuffer, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
        let n = MotionEstimator.size
        let crop = min(width, height)
        guard crop >= n else { return }

        // Centre square → n×n grid of block averages (luma × 8).
        let luma = base.assumingMemoryBound(to: UInt8.self)
        let originX = (width - crop) / 2, originY = (height - crop) / 2
        let block = crop / n
        let step = max(1, block / 6)
        let taps = (block + step - 1) / step
        let scale = 8.0 / Double(taps * taps)
        grid.withUnsafeMutableBufferPointer { out in
            for gy in 0..<n {
                let y0 = originY + gy * block
                for gx in 0..<n {
                    let x0 = originX + gx * block
                    var sum = 0
                    var y = 0
                    while y < block {
                        let row = luma + (y0 + y) * stride + x0
                        var x = 0
                        while x < block {
                            sum += Int(row[x])
                            x += step
                        }
                        y += step
                    }
                    out[gy * n + gx] = UInt16(Double(sum) * scale)
                }
            }
        }

        let sample = grid.withUnsafeBufferPointer { estimator.process($0) }
        let dt: Double
        if let last = lastTimestamp, timestamp > last, timestamp - last < 0.25 {
            dt = timestamp - last
        } else {
            dt = 1.0 / 60.0
        }
        lastTimestamp = timestamp
        onMotion?(sample, dt)
    }
}

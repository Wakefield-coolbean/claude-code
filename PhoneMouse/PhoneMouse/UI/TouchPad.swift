import SwiftUI
import UIKit

/// Raw UIKit touch tracking: fires on finger-down with no gesture delay, and several pads can be
/// held at once (left button + wheel, both buttons…), which is what a mouse needs.
struct TouchPad: UIViewRepresentable {
    var onDown: (CGPoint) -> Void = { _ in }
    var onMove: (_ location: CGPoint, _ delta: CGPoint) -> Void = { _, _ in }
    var onUp: () -> Void = {}

    func makeUIView(context: Context) -> PadView {
        let view = PadView()
        view.backgroundColor = .clear
        view.isMultipleTouchEnabled = false
        view.isExclusiveTouch = false
        return view
    }

    func updateUIView(_ view: PadView, context: Context) {
        view.onDown = onDown
        view.onMove = onMove
        view.onUp = onUp
    }

    final class PadView: UIView {
        var onDown: (CGPoint) -> Void = { _ in }
        var onMove: (CGPoint, CGPoint) -> Void = { _, _ in }
        var onUp: () -> Void = {}
        private var active: UITouch?

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard active == nil, let touch = touches.first else { return }
            active = touch
            onDown(touch.location(in: self))
        }

        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let touch = active, touches.contains(touch) else { return }
            let now = touch.location(in: self), before = touch.previousLocation(in: self)
            onMove(now, CGPoint(x: now.x - before.x, y: now.y - before.y))
        }

        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { finish(touches) }
        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { finish(touches) }

        private func finish(_ touches: Set<UITouch>) {
            guard let touch = active, touches.contains(touch) else { return }
            active = nil
            onUp()
        }
    }
}

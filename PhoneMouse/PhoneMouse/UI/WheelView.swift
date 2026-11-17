import SwiftUI

/// Scroll wheel: drag to scroll (with a tick per notch and a little momentum), tap to middle-click.
struct WheelView: View {
    @EnvironmentObject private var model: AppModel

    private let notchSpacing: CGFloat = 16

    @State private var offset: CGFloat = 0          // total travel, points (+ = finger moved down)
    @State private var active = false
    @State private var travelled: CGFloat = 0
    @State private var downAt = Date()
    @State private var velocity: CGFloat = 0        // points per second
    @State private var lastMove = Date()
    @State private var momentum: Timer?

    var body: some View {
        ZStack {
            // Well
            Capsule().fill(Theme.well)
            Capsule().strokeBorder(
                LinearGradient(colors: [Color.black, Color.white.opacity(0.14)], startPoint: .top, endPoint: .bottom),
                lineWidth: 1.5)

            // Wheel
            Canvas { context, size in
                let phase = offset.truncatingRemainder(dividingBy: notchSpacing)
                var y = phase - notchSpacing
                while y < size.height + notchSpacing {
                    // Ridges bunch up toward the top and bottom, like a cylinder seen from above.
                    let t = (y / size.height) * 2 - 1
                    let curved = sin(max(-1, min(1, t)) * .pi / 2)
                    let cy = (curved + 1) / 2 * size.height
                    let thickness = max(1.2, 5.5 * cos(max(-1, min(1, t)) * .pi / 2))
                    let rect = CGRect(x: 5, y: cy - thickness / 2, width: size.width - 10, height: thickness)
                    context.fill(Path(roundedRect: rect, cornerRadius: thickness / 2),
                                 with: .color(Color.white.opacity(0.20)))
                    y += notchSpacing
                }
            }
            .background(
                LinearGradient(colors: [Color(white: 0.03), Color(white: 0.24), Color(white: 0.30),
                                        Color(white: 0.22), Color(white: 0.03)],
                               startPoint: .top, endPoint: .bottom))
            .clipShape(Capsule())
            .padding(.horizontal, 13)
            .padding(.vertical, 9)

            // Light strips either side of the wheel
            HStack {
                strip
                Spacer()
                strip
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 26)
        }
        .overlay(TouchPad(onDown: { _ in begin() }, onMove: { _, delta in drag(delta.y) }, onUp: { end() }))
        .onDisappear { momentum?.invalidate() }
        .accessibilityLabel("Scroll wheel")
    }

    private var strip: some View {
        Capsule()
            .fill(Theme.glow)
            .frame(width: 2.5)
            .shadow(color: Theme.cyan.opacity(active ? 1 : 0.5), radius: active ? 7 : 3)
            .opacity(active ? 1 : 0.55)
            .animation(.easeOut(duration: 0.15), value: active)
    }

    private func begin() {
        momentum?.invalidate()
        momentum = nil
        active = true
        travelled = 0
        velocity = 0
        downAt = Date()
        lastMove = Date()
    }

    private func drag(_ dy: CGFloat) {
        let now = Date()
        let dt = max(now.timeIntervalSince(lastMove), 0.004)
        lastMove = now
        velocity = 0.6 * velocity + 0.4 * (dy / CGFloat(dt))
        travelled += abs(dy)
        advance(by: dy)
    }

    private func end() {
        active = false
        if travelled < 8 && Date().timeIntervalSince(downAt) < 0.35 {
            // A tap: middle click.
            model.press(.middle, down: true)
            model.press(.middle, down: false)
            return
        }
        guard abs(velocity) > 250, Date().timeIntervalSince(lastMove) < 0.08 else { return }
        momentum = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { timer in
            velocity *= 0.95
            if abs(velocity) < 40 {
                timer.invalidate()
                return
            }
            advance(by: velocity / 60)
        }
    }

    /// Moves the wheel and sends the matching scroll. Finger up = wheel rolls away = scroll up.
    private func advance(by dy: CGFloat) {
        let before = (offset / notchSpacing).rounded(.down)
        offset += dy
        if (offset / notchSpacing).rounded(.down) != before { model.wheelTick() }
        model.scroll(notches: Double(-dy / notchSpacing))
    }
}

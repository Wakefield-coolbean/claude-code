import SwiftUI

/// The whole screen is the top of a mouse: two keys, a wheel on the seam, and a palm area
/// carrying the sensor read-out and controls.
struct MouseView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var settings: Settings
    @EnvironmentObject private var link: MouseLink

    @State private var leftDown = false
    @State private var rightDown = false
    @State private var showConnect = false
    @State private var showSettings = false

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let keysHeight = size.height * 0.56
            let shell = RoundedRectangle(cornerRadius: 52, style: .continuous)

            ZStack(alignment: .top) {
                Theme.backdrop.ignoresSafeArea()

                ZStack(alignment: .top) {
                    // Shell
                    LinearGradient(colors: [Theme.shellTop, Theme.shellBottom], startPoint: .top, endPoint: .bottom)
                    RadialGradient(colors: [Color.white.opacity(0.10), .clear],
                                   center: UnitPoint(x: 0.2, y: 0.05), startRadius: 0, endRadius: size.width * 0.9)
                        .allowsHitTesting(false)

                    // Palm area
                    VStack(spacing: 0) {
                        Spacer().frame(height: keysHeight + 14)
                        palm
                    }

                    // Keys
                    HStack(spacing: 3) {
                        key(mirrored: false, down: leftDown) { down in
                            leftDown = down
                            model.press(.primary, down: down)
                        }
                        key(mirrored: true, down: rightDown) { down in
                            rightDown = down
                            model.press(.secondary, down: down)
                        }
                    }
                    .frame(height: keysHeight)

                    // Wheel on the seam
                    WheelView()
                        .frame(width: 66, height: min(210, keysHeight * 0.5))
                        .padding(.top, keysHeight * 0.17)
                }
                .clipShape(shell)
                .overlay(
                    shell.strokeBorder(
                        LinearGradient(colors: [Color.white.opacity(0.22), Color.white.opacity(0.03)],
                                       startPoint: .top, endPoint: .bottom), lineWidth: 1)
                )
                .shadow(color: accent.opacity(link.isConnected ? 0.22 : 0.08), radius: 24)
                .padding(6)
            }
        }
        .ignoresSafeArea()
        .sheet(isPresented: $showConnect) { ConnectSheet() }
        .sheet(isPresented: $showSettings) { SettingsSheet() }
        .onAppear { if !link.isConnected && link.lastTarget == nil { showConnect = true } }
        .onChange(of: link.state) { _, state in
            if case .needsPIN = state { showConnect = true }
        }
    }

    private var accent: Color {
        switch link.state {
        case .connected: return Theme.cyan
        case .connecting: return Theme.amber
        case .failed, .needsPIN: return Theme.red
        case .idle: return Theme.violet
        }
    }

    // MARK: - Keys

    private func key(mirrored: Bool, down: Bool, action: @escaping (Bool) -> Void) -> some View {
        let shape = KeyShape(mirrored: mirrored)
        return ZStack {
            shape.fill(LinearGradient(colors: down ? [Theme.keyBottom, Theme.keyBottom.opacity(0.9)]
                                                   : [Theme.keyTop, Theme.keyBottom],
                                      startPoint: .top, endPoint: .bottom))
            // Soft highlight that dims when the key is pressed.
            shape.fill(LinearGradient(colors: [Color.white.opacity(down ? 0.02 : 0.09), .clear],
                                      startPoint: mirrored ? .topTrailing : .topLeading, endPoint: .center))
            // Glow along the lower edge while held.
            shape.stroke(Theme.glow, lineWidth: 2)
                .blur(radius: 5)
                .opacity(down ? 0.9 : 0)
            shape.stroke(Color.black.opacity(0.55), lineWidth: 1)
        }
        .scaleEffect(down ? 0.988 : 1, anchor: .top)
        .animation(.easeOut(duration: 0.07), value: down)
        .overlay(TouchPad(onDown: { _ in action(true) }, onUp: { action(false) }))
        .accessibilityLabel(mirrored ? "Right button" : "Left button")
    }

    // MARK: - Palm

    private var palm: some View {
        VStack(spacing: 0) {
            SpeedButton()
            Spacer(minLength: 8)
            SensorOrb()
            Spacer(minLength: 8)
            connectionChip
            Spacer(minLength: 10)
            HStack {
                roundButton("gearshape.fill", label: "Settings") { showSettings = true }
                Spacer()
                roundButton(settings.torch ? "flashlight.on.fill" : "flashlight.off.fill",
                            label: "Surface light", tint: settings.torch ? Theme.cyan : Theme.label) {
                    settings.torch.toggle()
                    model.tap()
                }
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 30)
        }
    }

    private var connectionChip: some View {
        Button {
            showConnect = true
        } label: {
            HStack(spacing: 8) {
                Circle().fill(accent).frame(width: 8, height: 8)
                    .shadow(color: accent, radius: 5)
                Text(statusText)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.9))
                    .lineLimit(1)
                if let ms = link.latencyMs, link.isConnected {
                    Text("\(Int(ms.rounded())) ms")
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundStyle(Theme.label)
                }
                Image(systemName: "chevron.up")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.faint)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Capsule().fill(Color.black.opacity(0.35)))
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 24)
    }

    private var statusText: String {
        switch link.state {
        case .idle: return "Connect to a computer"
        case .connecting(let name): return "Connecting to \(name)…"
        case .needsPIN: return "Enter PIN"
        case .connected(let name): return name
        case .failed: return "Not connected"
        }
    }

    private func roundButton(_ symbol: String, label: String, tint: Color = Theme.label,
                             action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 46, height: 46)
                .background(Circle().fill(Color.black.opacity(0.35)))
                .overlay(Circle().strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// The little speed switch behind the wheel, like a DPI button.
private struct SpeedButton: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var settings: Settings

    var body: some View {
        Button {
            settings.cycleSpeed()
            model.tap()
        } label: {
            HStack(spacing: 5) {
                Text("SPEED")
                    .font(.system(size: 9, weight: .heavy, design: .rounded))
                    .kerning(1.2)
                    .foregroundStyle(Theme.faint)
                    .padding(.trailing, 3)
                ForEach(0..<Settings.speedPresets.count, id: \.self) { i in
                    Capsule()
                        .fill(i <= settings.speedLevel ? AnyShapeStyle(Theme.glow) : AnyShapeStyle(Color.white.opacity(0.1)))
                        .frame(width: 12, height: 4)
                        .shadow(color: i <= settings.speedLevel ? Theme.cyan.opacity(0.8) : .clear, radius: 3)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(Capsule().fill(Theme.well))
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.07), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.15), value: settings.speedLevel)
        .accessibilityLabel("Pointer speed")
    }
}

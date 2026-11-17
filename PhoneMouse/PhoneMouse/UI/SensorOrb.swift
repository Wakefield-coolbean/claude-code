import SwiftUI

/// The "optical sensor" in the palm: shows whether the camera can see the surface, which way the
/// pointer is being pushed, and doubles as the pause button.
struct SensorOrb: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var stats: TrackingStats
    @EnvironmentObject private var link: MouseLink

    var body: some View {
        VStack(spacing: 10) {
            Button {
                if stats.camera == .denied { model.openSystemSettings() } else { model.paused.toggle() }
                model.tap()
            } label: {
                orb
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.paused ? "Resume tracking" : "Pause tracking")

            Text(caption)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .kerning(0.6)
                .foregroundStyle(captionColor)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 30)
        }
    }

    private var live: Bool { stats.camera == .running && !model.paused }
    private var tint: Color {
        if !live { return Theme.faint }
        return stats.tracked ? Theme.cyan : Theme.amber
    }

    private var orb: some View {
        ZStack {
            Circle().fill(Theme.well)
            Circle().fill(RadialGradient(colors: [tint.opacity(live ? 0.28 : 0.06), .clear],
                                         center: .center, startRadius: 0, endRadius: 62))

            // Surface-quality arc
            Circle()
                .trim(from: 0, to: live ? max(0.03, stats.quality) : 0)
                .stroke(Theme.glow, style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(7)
                .shadow(color: Theme.cyan.opacity(0.7), radius: 5)
                .animation(.easeOut(duration: 0.2), value: stats.quality)
            Circle().strokeBorder(Color.white.opacity(0.07), lineWidth: 3.5).padding(5.25)

            // Crosshair
            Group {
                Rectangle().frame(width: 1, height: 70)
                Rectangle().frame(width: 70, height: 1)
            }
            .foregroundStyle(Color.white.opacity(0.06))

            if stats.camera == .denied || stats.camera == .unavailable {
                Image(systemName: "video.slash.fill")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(Theme.red)
            } else if model.paused {
                Image(systemName: "pause.fill")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Theme.label)
            } else {
                // Dot that leans the way the pointer is moving
                Circle()
                    .fill(tint)
                    .frame(width: 13, height: 13)
                    .shadow(color: tint, radius: 9)
                    .offset(x: stats.vectorX * 34, y: stats.vectorY * 34)
                    .animation(.easeOut(duration: 0.08), value: stats.vectorX)
                    .animation(.easeOut(duration: 0.08), value: stats.vectorY)
            }
        }
        .frame(width: 124, height: 124)
        .overlay(Circle().strokeBorder(
            LinearGradient(colors: [Color.black, Color.white.opacity(0.16)], startPoint: .top, endPoint: .bottom),
            lineWidth: 1.5))
        .contentShape(Circle())
    }

    private var caption: String {
        switch stats.camera {
        case .denied: return "CAMERA ACCESS NEEDED · TAP TO OPEN SETTINGS"
        case .unavailable: return "NO BACK CAMERA AVAILABLE"
        case .idle: return "STARTING SENSOR…"
        case .running:
            if model.paused { return "PAUSED · TAP TO RESUME" }
            if !stats.tracked { return "CAN'T SEE THE SURFACE · TRY A TEXTURED ONE" }
            return "TRACKING · \(stats.fps) FPS"
        }
    }

    private var captionColor: Color {
        if stats.camera == .denied || stats.camera == .unavailable { return Theme.red }
        if live && !stats.tracked { return Theme.amber }
        return Theme.label
    }
}

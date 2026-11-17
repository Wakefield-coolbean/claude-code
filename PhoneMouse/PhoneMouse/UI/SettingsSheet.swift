import SwiftUI

struct SettingsSheet: View {
    @EnvironmentObject private var settings: Settings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    slider("Speed", value: speedBinding, range: 0...1, label: "\(Int(settings.sensitivity))")
                    slider("Acceleration", value: $settings.acceleration, range: 0...1.5,
                           label: settings.acceleration < 0.05 ? "Off" : String(format: "%.1f", settings.acceleration))
                    Toggle("Reverse left / right", isOn: $settings.invertX)
                    Toggle("Reverse forward / back", isOn: $settings.invertY)
                } header: {
                    Text("Pointer")
                } footer: {
                    Text("If the pointer moves the opposite way to the phone, flip the matching switch.")
                }

                Section {
                    slider("Scroll speed", value: $settings.scrollSpeed, range: 0.25...3,
                           label: String(format: "%.2g×", settings.scrollSpeed))
                    Toggle("Natural scrolling", isOn: $settings.naturalScroll)
                } header: {
                    Text("Wheel")
                }

                Section {
                    Toggle("Surface light", isOn: $settings.torch)
                    if settings.torch {
                        slider("Brightness", value: $settings.torchLevel, range: 0.05...1,
                               label: "\(Int(settings.torchLevel * 100))%")
                    }
                    Toggle("Use ultra-wide camera", isOn: $settings.ultraWide)
                } header: {
                    Text("Sensor")
                } footer: {
                    Text("The light on the back illuminates the surface under the phone, like the LED in an optical mouse. The ultra-wide camera sees more of the surface, which helps with fast movements on phones that have one.")
                }

                Section {
                    Toggle("Click feel (haptics)", isOn: $settings.haptics)
                    Toggle("Left-handed buttons", isOn: $settings.leftHanded)
                } header: {
                    Text("Buttons")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .tint(Theme.cyan)
    }

    /// Speed on a log scale so each step of the slider feels like the same change.
    private var speedBinding: Binding<Double> {
        let low = log(100.0), high = log(3200.0)
        return Binding(
            get: { (log(settings.sensitivity) - low) / (high - low) },
            set: { settings.sensitivity = exp(low + $0 * (high - low)).rounded() }
        )
    }

    private func slider(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, label: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                Spacer()
                Text(label).foregroundStyle(.secondary).monospacedDigit()
            }
            Slider(value: value, in: range)
        }
    }
}

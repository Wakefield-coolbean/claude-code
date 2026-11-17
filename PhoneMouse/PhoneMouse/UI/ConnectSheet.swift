import SwiftUI

struct ConnectSheet: View {
    @EnvironmentObject private var link: MouseLink
    @EnvironmentObject private var browser: ServerBrowser
    @Environment(\.dismiss) private var dismiss

    @State private var pin = ""
    @State private var address = ""
    @State private var showManual = false
    @FocusState private var pinFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    statusCard
                    if case .needsPIN(let target, let wrong) = link.state {
                        pinCard(target: target, wrong: wrong)
                    } else {
                        computers
                        manual
                        howTo
                    }
                }
                .padding(20)
            }
            .background(Theme.backdrop.ignoresSafeArea())
            .navigationTitle("Computer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.large])
        .tint(Theme.cyan)
        .onChange(of: link.state) { _, state in
            if case .connected = state { dismiss() }
        }
    }

    // MARK: - Sections

    private var statusCard: some View {
        HStack(spacing: 12) {
            Image(systemName: statusSymbol)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(statusTint)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(statusTitle).font(.system(size: 16, weight: .semibold, design: .rounded))
                if let detail = statusDetail {
                    Text(detail).font(.footnote).foregroundStyle(Theme.label)
                }
            }
            Spacer()
            if link.isConnected {
                Button("Disconnect", role: .destructive) { link.disconnect() }
                    .font(.system(size: 14, weight: .semibold))
            } else if case .connecting = link.state {
                ProgressView()
            }
        }
        .card()
    }

    private func pinCard(target: LinkTarget, wrong: Bool) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("PIN for \(target.title)")
                .font(.system(size: 16, weight: .semibold, design: .rounded))
            Text(wrong ? "That PIN didn't match. Check the 6 digits shown by the receiver on your computer."
                       : "Type the 6-digit PIN shown by the receiver on your computer. You only do this once.")
                .font(.footnote)
                .foregroundStyle(wrong ? Theme.red : Theme.label)
            TextField("000000", text: $pin)
                .keyboardType(.numberPad)
                .font(.system(size: 34, weight: .bold, design: .monospaced))
                .multilineTextAlignment(.center)
                .focused($pinFocused)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 14).fill(Color.black.opacity(0.4)))
                .onChange(of: pin) { _, value in
                    let digits = String(value.filter { $0.isNumber }.prefix(6))
                    if digits != value { pin = digits }
                }
            HStack {
                Button("Cancel") { link.disconnect() }
                    .foregroundStyle(Theme.label)
                Spacer()
                Button {
                    link.connect(to: target, pin: pin)
                    pin = ""
                } label: {
                    Text("Pair").font(.system(size: 16, weight: .bold, design: .rounded))
                        .padding(.horizontal, 26).padding(.vertical, 10)
                        .background(Capsule().fill(Theme.glow))
                        .foregroundStyle(.black)
                }
                .disabled(pin.count != 6)
                .opacity(pin.count == 6 ? 1 : 0.4)
            }
        }
        .card()
        .onAppear { pinFocused = true }
    }

    private var computers: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("ON THIS NETWORK")
            if browser.servers.isEmpty {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Looking for computers running the receiver…")
                        .font(.footnote).foregroundStyle(Theme.label)
                }
                .card()
            } else {
                ForEach(browser.servers, id: \.self) { name in
                    Button {
                        link.connect(to: .bonjour(name: name))
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "desktopcomputer")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(Theme.cyan)
                                .frame(width: 30)
                            Text(name).font(.system(size: 16, weight: .medium, design: .rounded))
                                .foregroundStyle(.white)
                            Spacer()
                            if case .connected(let current) = link.state, current == name {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.cyan)
                            } else {
                                Image(systemName: "chevron.right").font(.footnote.bold()).foregroundStyle(Theme.faint)
                            }
                        }
                        .card()
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var manual: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) { showManual.toggle() }
            } label: {
                HStack {
                    sectionTitle("ENTER ADDRESS")
                    Image(systemName: showManual ? "chevron.up" : "chevron.down")
                        .font(.caption2.bold()).foregroundStyle(Theme.faint)
                }
            }
            .buttonStyle(.plain)
            if showManual {
                HStack(spacing: 10) {
                    TextField("192.168.1.20", text: $address)
                        .keyboardType(.numbersAndPunctuation)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.system(size: 16, design: .monospaced))
                    Button("Connect") { connectManually() }
                        .font(.system(size: 15, weight: .semibold))
                        .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .card()
                Text("Use the address the receiver prints, e.g. 192.168.1.20 or 192.168.1.20:47800.")
                    .font(.caption).foregroundStyle(Theme.faint)
            }
        }
    }

    private var howTo: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("FIRST TIME?")
            VStack(alignment: .leading, spacing: 12) {
                step(1, "On your computer, run the PhoneMouse receiver:")
                Text("pip install pynput zeroconf\npython3 phonemouse_server.py")
                    .font(.system(size: 12.5, design: .monospaced))
                    .foregroundStyle(Theme.cyan)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.black.opacity(0.45)))
                step(2, "Keep the phone and the computer on the same Wi-Fi.")
                step(3, "Pick the computer above and type the PIN it shows.")
                step(4, "Slide the phone like a mouse. The camera on the back watches the surface, so textured surfaces work best.")
            }
            .card()
        }
    }

    // MARK: - Helpers

    private func connectManually() {
        var host = address.trimmingCharacters(in: .whitespaces)
        var port = LinkTarget.defaultPort
        if let colon = host.lastIndex(of: ":"), host.filter({ $0 == ":" }).count == 1,
           let parsed = UInt16(host[host.index(after: colon)...]) {
            port = parsed
            host = String(host[..<colon])
        }
        guard !host.isEmpty else { return }
        link.connect(to: .host(address: host, port: port))
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .heavy, design: .rounded))
            .kerning(1.2)
            .foregroundStyle(Theme.faint)
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)")
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .foregroundStyle(.black)
                .frame(width: 20, height: 20)
                .background(Circle().fill(Theme.glow))
            Text(text).font(.subheadline).foregroundStyle(.white.opacity(0.85))
        }
    }

    private var statusSymbol: String {
        switch link.state {
        case .connected: return "checkmark.circle.fill"
        case .connecting: return "dot.radiowaves.left.and.right"
        case .needsPIN: return "lock.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .idle: return "cable.connector"
        }
    }

    private var statusTint: Color {
        switch link.state {
        case .connected: return Theme.cyan
        case .connecting: return Theme.amber
        case .needsPIN: return Theme.violet
        case .failed: return Theme.red
        case .idle: return Theme.label
        }
    }

    private var statusTitle: String {
        switch link.state {
        case .connected(let name): return "Connected to \(name)"
        case .connecting(let name): return "Connecting to \(name)…"
        case .needsPIN: return "Pairing"
        case .failed: return "Not connected"
        case .idle: return "Not connected"
        }
    }

    private var statusDetail: String? {
        switch link.state {
        case .connected:
            if let ms = link.latencyMs { return "Latency \(Int(ms.rounded())) ms" }
            return nil
        case .failed(let message): return message
        case .idle: return "Pick a computer below."
        default: return nil
        }
    }
}

private struct Card: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.06)))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.white.opacity(0.07), lineWidth: 1))
    }
}

extension View {
    func card() -> some View { modifier(Card()) }
}

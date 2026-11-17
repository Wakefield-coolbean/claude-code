import SwiftUI

@main
struct PhoneMouseApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            MouseView()
                .environmentObject(model)
                .environmentObject(model.settings)
                .environmentObject(model.link)
                .environmentObject(model.browser)
                .environmentObject(model.stats)
                .preferredColorScheme(.dark)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .defersSystemGestures(on: .all)
                .onAppear { if scenePhase == .active { model.activate() } }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { model.activate() } else if phase == .background { model.deactivate() }
                }
        }
    }
}

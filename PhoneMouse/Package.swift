// swift-tools-version:5.9
// Lets the camera-independent core (motion estimator, filters) be unit-tested with `swift test`.
// The app itself is built from PhoneMouse.xcodeproj.
import PackageDescription

let package = Package(
    name: "PhoneMouseCore",
    targets: [
        .target(name: "PhoneMouseCore", path: "PhoneMouse/Core"),
        .testTarget(name: "CoreTests", dependencies: ["PhoneMouseCore"], path: "Tests/CoreTests"),
    ]
)

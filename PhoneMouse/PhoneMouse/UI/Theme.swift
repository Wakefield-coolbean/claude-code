import SwiftUI

enum Theme {
    static let backdrop = Color(red: 0.02, green: 0.022, blue: 0.03)
    static let shellTop = Color(red: 0.19, green: 0.20, blue: 0.235)
    static let shellBottom = Color(red: 0.065, green: 0.068, blue: 0.085)
    static let keyTop = Color(red: 0.215, green: 0.225, blue: 0.265)
    static let keyBottom = Color(red: 0.115, green: 0.12, blue: 0.145)
    static let well = Color(red: 0.025, green: 0.027, blue: 0.035)

    static let cyan = Color(red: 0.24, green: 0.90, blue: 1.0)
    static let violet = Color(red: 0.56, green: 0.38, blue: 1.0)
    static let amber = Color(red: 1.0, green: 0.72, blue: 0.25)
    static let red = Color(red: 1.0, green: 0.33, blue: 0.38)

    static let glow = LinearGradient(colors: [cyan, violet], startPoint: .topLeading, endPoint: .bottomTrailing)
    static let label = Color.white.opacity(0.55)
    static let faint = Color.white.opacity(0.28)
}

/// A mouse key: flat top edge, bottom edge that sweeps down toward the centre seam.
struct KeyShape: Shape {
    var mirrored: Bool
    var sweep: CGFloat = 34

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let outer = mirrored ? rect.maxX : rect.minX
        let inner = mirrored ? rect.minX : rect.maxX
        p.move(to: CGPoint(x: outer, y: rect.minY))
        p.addLine(to: CGPoint(x: inner, y: rect.minY))
        p.addLine(to: CGPoint(x: inner, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: outer, y: rect.maxY - sweep),
                       control: CGPoint(x: (outer + inner) / 2, y: rect.maxY - sweep * 0.1))
        p.closeSubpath()
        return p
    }
}

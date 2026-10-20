import SwiftUI
import WidgetKit

// The host app carries the widget extension. Its own window is just a
// placeholder — the widgets live in Notification Center / the desktop.
// Launching it also reloads every placed widget's timeline: WidgetKit
// otherwise keeps serving an entry rendered by the OLD extension build
// until the next scheduled refresh, which hides rebuilds.
@main
struct GrokShellHostApp: App {
    init() {
        WidgetCenter.shared.reloadAllTimelines()
    }
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 14) {
                Text("Gen UI Widgets")
                    .font(.title2).fontWeight(.semibold)
                Text("The widgets ship inside this app.\nAdd them from Notification Center → Edit Widgets → Gen UI Widgets.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Text("Data source: http://127.0.0.1:8787/data/…\n(the gen-server must be running)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
            }
            .padding(32)
            .frame(minWidth: 360, minHeight: 220)
        }
        .defaultSize(width: 400, height: 260)
    }
}

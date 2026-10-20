import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Data model — mirrors GET /widget-feed on the gen-server.
// The feed is the generic channel: every generated/published widget's
// persisted state + first-party sources (linear, timeclock) as card rows.
// Widget UI is always SwiftUI (WidgetKit can't run TSX) — but tapping a
// module row POSTs /popout and opens the real generated UI in its own
// Native Shell window.

private let API = "http://127.0.0.1:8787"

struct FeedLine: Codable {
    let text: String
    let url: String?
}

struct FeedItem: Codable, Identifiable {
    let id: String
    let title: String
    let module: String?   // set → tappable: opens this module's NSH pop-out
    let pinned: Bool?
    let lines: [FeedLine]
    let view: ViewPayload?  // template payload — the item rendered natively

    static let preview = FeedItem(
        id: "R39", title: "Pomodoro timer", module: "R39", pinned: true,
        lines: [FeedLine(text: "sessions: 1", url: nil),
                FeedLine(text: "minutesFocused: 25", url: nil)], view: nil)
}

// The widget templates: what a mini-app looks like as a real desktop
// widget. The feed's `view` carries a kind + typed fields — the app
// itself can shape its own widget by persisting a `widget` object in its
// state; otherwise the server infers a kind from the state's shape.
struct ViewPayload: Codable {
    let kind: String
    let running: Bool?
    let startedAt: String?      // ISO-8601 — the clock template ticks live
    let todayMin: Int?
    let label: String?
    let value: String?
    let unit: String?
    let sub: String?
    let fraction: Double?
    let temp: Double?
    let condition: String?
    let high: Double?
    let low: Double?
    let headline: String?
    let body: String?
    let rows: [ViewRow]?
    let days: [ViewDay]?
}
struct ViewRow: Codable { let title: String; let detail: String?; let url: String? }
struct ViewDay: Codable { let label: String; let icon: String?; let high: Double?; let low: Double? }

struct Feed: Codable {
    let updated: String
    let items: [FeedItem]
}

struct FeedEntry: TimelineEntry {
    let date: Date
    let items: [FeedItem]
    let selected: String?   // configured mini-app id; nil → overview
    let image: Data?        // the configured app's real UI, rendered to PNG
    let error: String?
}

// MARK: - Intents

struct RefreshIntent: AppIntent {
    static var title: LocalizedStringResource = "Refresh"
    func perform() async throws -> some IntentResult {
        WidgetCenter.shared.reloadTimelines(ofKind: "GrokShellLinearWidget")
        return .result()
    }
}

// Tapping a widget row asks the gen-server to pop that module out into its
// own Native Shell window — the desktop widget becomes a launcher for the
// real generated UIs.
struct OpenWidgetIntent: AppIntent {
    static var title: LocalizedStringResource = "Open widget"
    @Parameter(title: "Module") var module: String
    init() { self.module = "" }
    init(module: String) { self.module = module }
    func perform() async throws -> some IntentResult {
        guard !module.isEmpty,
              let url = URL(string: "\(API)/popout") else { return .result() }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONEncoder().encode(["name": module])
        _ = try? await URLSession.shared.data(for: req)
        return .result()
    }
}

// MARK: - Configuration — "nominate" a mini-app per widget slot.
// Long-press widget → Edit Widget → Mini App picker lists every feed item
// (generated widgets + sources) live from the gen-server.

struct MiniAppEntity: AppEntity {
    let id: String
    let title: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Mini App"
    static var defaultQuery = MiniAppQuery()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)")
    }
}

struct MiniAppQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [MiniAppEntity] {
        await Self.fetch().filter { identifiers.contains($0.id) }
    }
    func suggestedEntities() async throws -> [MiniAppEntity] {
        await Self.fetch()
    }
    private static func fetch() async -> [MiniAppEntity] {
        guard let url = URL(string: "\(API)/widget-feed") else { return [] }
        var req = URLRequest(url: url)
        req.timeoutInterval = 8
        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let feed = try? JSONDecoder().decode(Feed.self, from: data)
        else { return [] }
        return feed.items
            .filter { $0.module != nil || $0.id == "linear" || $0.id == "timeclock" }
            .map { MiniAppEntity(id: $0.id, title: $0.title) }
    }
}

struct SelectWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Choose a Mini App"
    static var description = IntentDescription(
        "Pin this widget to one generated mini-app, or leave it on the overview.")
    @Parameter(title: "Mini App")
    var app: MiniAppEntity?
}

// MARK: - Timeline provider — fetch → entry, refresh every 15 min.

struct Provider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> FeedEntry {
        FeedEntry(date: .now, items: [.preview, .preview], selected: nil, image: nil, error: nil)
    }
    func snapshot(for configuration: SelectWidgetIntent, in context: Context) async -> FeedEntry {
        await load(selected: configuration.app?.id, size: context.displaySize)
    }
    func timeline(for configuration: SelectWidgetIntent, in context: Context) async -> Timeline<FeedEntry> {
        let entry = await load(selected: configuration.app?.id, size: context.displaySize)
        let next = Date().addingTimeInterval(15 * 60)
        return Timeline(entries: [entry], policy: .after(next))
    }

    private func load(selected: String?, size: CGSize) async -> FeedEntry {
        guard let url = URL(string: "\(API)/widget-feed") else {
            return FeedEntry(date: .now, items: [], selected: selected, image: nil, error: "bad url")
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = 8
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            let feed = try JSONDecoder().decode(Feed.self, from: data)
            // A configured mini-app renders natively from its `view`
            // payload; only fall back to a rendered PNG when it has none.
            var image: Data? = nil
            if let sel = selected,
               let item = feed.items.first(where: { $0.id == sel }),
               item.module != nil, item.view == nil {
                image = await shot(name: item.module!, size: size)
            }
            return FeedEntry(date: .now, items: feed.items, selected: selected, image: image, error: nil)
        } catch {
            return FeedEntry(date: .now, items: [], selected: selected, image: nil, error: "gen-server offline")
        }
    }

    private func shot(name: String, size: CGSize) async -> Data? {
        let w = Int(size.width.rounded()), h = Int(size.height.rounded())
        guard let url = URL(string: "\(API)/widget-shot?name=\(name)&w=\(w)&h=\(h)")
        else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 40  // a cold spawn + first render takes a few seconds
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200
        else { return nil }
        return data
    }
}

// MARK: - Views

private let accent = Color(red: 0.37, green: 0.42, blue: 0.83)

struct GrokShellFeedView: View {
    @Environment(\.widgetFamily) var family
    var entry: FeedEntry

    var body: some View {
        if entry.error != nil {
            offline
        } else if let sel = entry.selected {
            selectedView(sel)
        } else if entry.items.isEmpty {
            Text("No widgets yet").font(.caption).foregroundStyle(.secondary)
        } else {
            switch family {
            case .systemSmall: small
            default: medium
            }
        }
    }

    // Configured: the chosen mini-app fills the slot, rendered by a
    // native template from its `view` payload — a real widget, not a
    // screenshot. Tap opens the live NSH window. The rendered-PNG path
    // and the text card are fallbacks.
    @ViewBuilder
    private func selectedView(_ id: String) -> some View {
        if let item = entry.items.first(where: { $0.id == id }) {
            if let v = item.view {
                let body = VStack(alignment: .leading, spacing: 0) {
                    miniHeader(item)
                    kindView(v)
                }
                if let m = item.module {
                    Button(intent: OpenWidgetIntent(module: m)) { body }
                        .buttonStyle(.plain)
                } else { body }
            } else if let data = entry.image, let img = NSImage(data: data), let m = item.module {
                Button(intent: OpenWidgetIntent(module: m)) {
                    Image(nsImage: img)
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .clipped()
                }
                .buttonStyle(.plain)
            } else if let m = item.module {
                Button(intent: OpenWidgetIntent(module: m)) { focusedCard(item) }
                    .buttonStyle(.plain)
            } else {
                focusedCard(item)
            }
        } else {
            VStack(spacing: 4) {
                Text(id).font(.caption).fontWeight(.semibold)
                Text("not in feed").font(.caption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // Slim title row above the template — who this is + a refresh.
    private func miniHeader(_ item: FeedItem) -> some View {
        HStack(spacing: 5) {
            if item.pinned == true {
                Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow)
            }
            Text(item.title).font(.caption).fontWeight(.semibold).lineLimit(1)
            Spacer()
            Button(intent: RefreshIntent()) {
                Image(systemName: "arrow.clockwise").font(.caption2)
            }
            .buttonStyle(.plain)
        }
        .padding(.bottom, 5)
    }

    // MARK: - Widget templates — one native layout per view.kind.

    @ViewBuilder
    private func kindView(_ v: ViewPayload) -> some View {
        switch v.kind {
        case "clock": clockView(v)
        case "progress": ringView(v)
        case "stat": statView(v)
        case "weather": weatherView(v)
        case "note": noteView(v)
        default: listTemplate(v)
        }
    }

    // clock: live status + a REAL ticking timer (SwiftUI's .timer style
    // counts on its own — no timeline refresh needed) + today's total.
    private func clockView(_ v: ViewPayload) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle()
                    .fill(v.running == true ? Color.green : Color.secondary.opacity(0.5))
                    .frame(width: 8, height: 8)
                Text(v.running == true ? "clocked in" : "clocked out")
                    .font(.caption).fontWeight(.medium)
                Spacer()
            }
            if v.running == true, let iso = v.startedAt,
               let d = ISO8601DateFormatter().date(from: iso) {
                Text(d, style: .timer)
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .monospacedDigit()
            }
            Text("\(v.todayMin ?? 0) min today")
                .font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // progress: ring + center value + side label/sub.
    private func ringView(_ v: ViewPayload) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().stroke(Color.secondary.opacity(0.2), lineWidth: 7)
                Circle()
                    .trim(from: 0, to: CGFloat(v.fraction ?? 0))
                    .stroke(accent, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text(v.value ?? "\(Int((v.fraction ?? 0) * 100))%")
                    .font(.caption).fontWeight(.bold)
            }
            .frame(width: 62, height: 62)
            VStack(alignment: .leading, spacing: 2) {
                if let l = v.label {
                    Text(l).font(.caption).fontWeight(.semibold).lineLimit(1)
                }
                if let s = v.sub {
                    Text(s).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            Spacer()
        }
    }

    // stat: one headline number + unit + what it is + a subline.
    private func statView(_ v: ViewPayload) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if let l = v.label {
                Text(l).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(v.value ?? "—")
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.5).lineLimit(1)
                if let u = v.unit {
                    Text(u).font(.headline).foregroundStyle(.secondary)
                }
            }
            if let s = v.sub {
                Text(s).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // weather: temp + condition + hi/lo + a mini forecast row.
    private func weatherView(_ v: ViewPayload) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                Text(v.temp.map { "\(Int($0.rounded()))\(v.unit ?? "°")" } ?? "—")
                    .font(.system(size: 34, weight: .bold))
                VStack(alignment: .leading, spacing: 1) {
                    if let c = v.condition {
                        Text(c).font(.caption).fontWeight(.medium).lineLimit(1)
                    }
                    if v.high != nil || v.low != nil {
                        Text("H\(v.high.map { String(Int($0.rounded())) } ?? "—")  L\(v.low.map { String(Int($0.rounded())) } ?? "—")")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }
            if let days = v.days, !days.isEmpty {
                HStack(spacing: 6) {
                    ForEach(days.indices, id: \.self) { i in
                        let d = days[i]
                        VStack(spacing: 2) {
                            Text(d.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                            Image(systemName: sfIcon(d.icon ?? d.label)).font(.caption2)
                            Text("\(d.high.map { String(Int($0.rounded())) } ?? "—")/\(d.low.map { String(Int($0.rounded())) } ?? "—")")
                                .font(.system(size: 9)).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }

    // note: a headline + a line of body text.
    private func noteView(_ v: ViewPayload) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let h = v.headline {
                Text(h).font(.subheadline).fontWeight(.semibold).lineLimit(2)
            }
            if let b = v.body {
                Text(b).font(.caption).foregroundStyle(.secondary).lineLimit(4)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // list: rows of title + detail; url rows deep-link on tap.
    private func listTemplate(_ v: ViewPayload) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach((v.rows ?? []).indices, id: \.self) { i in
                let r = v.rows![i]
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(r.title).font(.caption).fontWeight(.medium).lineLimit(1)
                    if let d = r.detail, !d.isEmpty {
                        Text(d).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sfIcon(_ s: String) -> String {
        let k = s.lowercased()
        if k.contains("storm") || k.contains("thunder") { return "cloud.bolt.fill" }
        if k.contains("rain") || k.contains("drizzle") { return "cloud.rain.fill" }
        if k.contains("snow") { return "snowflake" }
        if k.contains("part") { return "cloud.sun.fill" }
        if k.contains("cloud") || k.contains("overcast") { return "cloud.fill" }
        if k.contains("fog") || k.contains("mist") { return "cloud.fog.fill" }
        if k.contains("moon") || k.contains("night") { return "moon.fill" }
        return "sun.max.fill"
    }

    private func focusedCard(_ item: FeedItem) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                if item.pinned == true {
                    Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow)
                }
                Text(item.title).font(.subheadline).fontWeight(.semibold).lineLimit(1)
                Spacer()
                Button(intent: RefreshIntent()) {
                    Image(systemName: "arrow.clockwise").font(.caption2)
                }
                .buttonStyle(.plain)
            }
            ForEach(item.lines.indices, id: \.self) { i in
                let line = item.lines[i]
                if let u = line.url, let url = URL(string: u) {
                    Link(destination: url) {
                        Text(line.text).font(.caption).lineLimit(1)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text(line.text).font(.caption).lineLimit(1)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if item.module != nil {
                Label("open mini app", systemImage: "arrow.up.forward.square")
                    .font(.caption2).foregroundStyle(accent)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // Small: first item (pinned widgets lead the feed), whole card opens it.
    private var small: some View {
        let item = entry.items[0]
        return Group {
            if let m = item.module {
                Button(intent: OpenWidgetIntent(module: m)) { smallCard(item) }
                    .buttonStyle(.plain)
            } else {
                smallCard(item)
            }
        }
    }

    private func smallCard(_ item: FeedItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                if item.pinned == true {
                    Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow)
                }
                Image(systemName: "square.grid.2x2.fill").foregroundStyle(accent)
                Text(item.title).font(.caption).fontWeight(.semibold).lineLimit(1)
                Spacer()
            }
            ForEach(item.lines.indices.prefix(3), id: \.self) { i in
                Text(item.lines[i].text)
                    .font(.caption).lineLimit(1).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if item.module != nil {
                Label("open", systemImage: "arrow.up.forward.square")
                    .font(.caption2).foregroundStyle(accent)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // Medium: header + up to 4 item rows; module rows pop out the real
    // generated UI, url rows deep-link to the browser (linear issues).
    private var medium: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Image(systemName: "square.grid.2x2.fill").foregroundStyle(accent)
                Text("Gen UI").font(.caption).fontWeight(.semibold)
                Text("· \(entry.items.count)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button(intent: RefreshIntent()) {
                    Image(systemName: "arrow.clockwise").font(.caption2)
                }
                .buttonStyle(.plain)
                Text(entry.date, style: .time).font(.caption2).foregroundStyle(.tertiary)
            }
            ForEach(entry.items.prefix(4)) { item in
                itemRow(item)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func itemRow(_ item: FeedItem) -> some View {
        if let m = item.module {
            Button(intent: OpenWidgetIntent(module: m)) {
                rowContent(item, chevron: true)
            }
            .buttonStyle(.plain)
        } else if item.lines.contains(where: { $0.url != nil }) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.caption).fontWeight(.semibold).lineLimit(1)
                ForEach(item.lines.indices.prefix(2), id: \.self) { i in
                    let line = item.lines[i]
                    if let u = line.url, let url = URL(string: u) {
                        Link(destination: url) {
                            Text(line.text).font(.caption).lineLimit(1)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Text(line.text).font(.caption).lineLimit(1)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } else {
            rowContent(item, chevron: false)
        }
    }

    private func rowContent(_ item: FeedItem, chevron: Bool) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(item.pinned == true ? Color.yellow : accent).frame(width: 3)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    if item.pinned == true {
                        Image(systemName: "star.fill").font(.system(size: 7))
                            .foregroundStyle(.yellow)
                    }
                    Text(item.title).font(.caption).fontWeight(.semibold).lineLimit(1)
                }
                Text(item.lines.map(\.text).prefix(2).joined(separator: " · "))
                    .font(.caption).lineLimit(1).foregroundStyle(.secondary)
            }
            Spacer()
            if chevron {
                Image(systemName: "arrow.up.forward.square")
                    .font(.caption2).foregroundStyle(accent)
            }
        }
    }

    private var offline: some View {
        VStack(spacing: 8) {
            Image(systemName: "bolt.slash").foregroundStyle(.secondary)
            Text(entry.error ?? "offline").font(.caption).foregroundStyle(.secondary)
            Button(intent: RefreshIntent()) {
                Text("Retry").font(.caption)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Widget + bundle

struct GrokShellFeedWidget: Widget {
    let kind = "GrokShellLinearWidget" // keep kind stable — placed widgets update in place
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: SelectWidgetIntent.self, provider: Provider()) { entry in
            GrokShellFeedView(entry: entry)
                .containerBackground(.regularMaterial, for: .widget)
        }
        .configurationDisplayName("Gen UI Feed")
        .description("Live cards from your generated widgets and data sources. Choose a mini-app to pin it here, or tap a row to open its window.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct GrokShellWidgetBundle: WidgetBundle {
    var body: some Widget {
        GrokShellFeedWidget()
    }
}

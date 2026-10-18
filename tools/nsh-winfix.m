// nsh-winfix — DYLD_INSERT_LIBRARIES shim for nsh-macos-host.
// The host opens pop-out windows at a fixed default frame (~628×1129) and
// exposes no setFrame API (upstream: longbridge/nsh#60). This shim runs
// in-process — no Accessibility grant needed — and resizes any window
// titled "widget · …" to NSH_WIN_W × NSH_WIN_H once it appears.
//
// Spawn contract (set by gen-server /popout):
//   DYLD_INSERT_LIBRARIES=<this dylib> NSH_WIN_W=420 NSH_WIN_H=500 nsh run …
#import <AppKit/AppKit.h>

static CGFloat winW = 0, winH = 0;

static void resizeIfWidget(NSWindow *w) {
	if (!winW || ![w isKindOfClass:[NSWindow class]]) return;
	if (![w.title hasPrefix:@"widget ·"]) return; // pop-outs only
	NSRect f = w.frame;
	f.size.width = winW;
	f.size.height = winH;
	[w setFrame:f display:YES animate:YES];
}

__attribute__((constructor)) static void boot(void) {
	const char *w = getenv("NSH_WIN_W"), *h = getenv("NSH_WIN_H");
	if (!w || !h) return;
	winW = atof(w);
	winH = atof(h);
	if (winW <= 0 || winH <= 0) {
		winW = winH = 0;
		return;
	}
	// The title lands right after mount — poll ~6s so we don't miss it,
	// and catch every later window via the visible notification.
	for (int i = 0; i < 40; i++) {
		dispatch_after(
			dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.15 * i * NSEC_PER_SEC)),
			dispatch_get_main_queue(), ^{
				for (NSWindow *win in NSApp.windows) resizeIfWidget(win);
			});
	}
	[[NSNotificationCenter defaultCenter]
		addObserverForName:NSWindowDidExposeNotification
				  object:nil
				   queue:nil
			  usingBlock:^(NSNotification *n) {
				resizeIfWidget(n.object);
			  }];
}

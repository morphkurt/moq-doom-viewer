/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
// Re-serves the page with COOP/COEP headers so `crossOriginIsolated` is true even
// on hosts that can't set response headers (e.g. GitHub Pages). MoQ's audio
// worklet needs SharedArrayBuffer, which requires isolation.
let coepCredentialless = false;
if (typeof window === "undefined") {
	self.addEventListener("install", () => self.skipWaiting());
	self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

	self.addEventListener("message", (ev) => {
		if (!ev.data) return;
		if (ev.data.type === "deregister") {
			self.registration
				.unregister()
				.then(() => self.clients.matchAll())
				.then((clients) => clients.forEach((client) => client.navigate(client.url)));
		} else if (ev.data.type === "coepCredentialless") {
			coepCredentialless = ev.data.value;
		}
	});

	self.addEventListener("fetch", (event) => {
		const r = event.request;
		if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;

		const request =
			coepCredentialless && r.mode === "no-cors" ? new Request(r, { credentials: "omit" }) : r;
		event.respondWith(
			fetch(request)
				.then((response) => {
					if (response.status === 0) return response;

					const newHeaders = new Headers(response.headers);
					newHeaders.set("Cross-Origin-Embedder-Policy", coepCredentialless ? "credentialless" : "require-corp");
					if (!coepCredentialless) newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
					newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

					return new Response(response.body, {
						status: response.status,
						statusText: response.statusText,
						headers: newHeaders,
					});
				})
				.catch((e) => console.error(e)),
		);
	});
} else {
	(() => {
		const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
		window.sessionStorage.removeItem("coiReloadedBySelf");
		const coepDegrading = reloadedBySelf === "coepdegrade";

		const n = navigator;
		const controlling = n.serviceWorker && n.serviceWorker.controller;

		// Reload only on the first controlled load in this tab, to avoid loops.
		if (controlling && !window.crossOriginIsolated) {
			window.sessionStorage.setItem("coiReloadedBySelf", "coiReloadWindow");
			window.location.reload();
		}

		const registerServiceWorker = () => {
			n.serviceWorker
				.register(window.document.currentScript.src)
				.then((registration) => {
					registration.addEventListener("updatefound", () => {
						window.sessionStorage.setItem("coiReloadedBySelf", "updatefound");
						window.location.reload();
					});

					if (registration.active && !n.serviceWorker.controller) {
						window.sessionStorage.setItem("coiReloadedBySelf", "notcontrolling");
						window.location.reload();
					}
				})
				.catch((err) => console.error("COOP/COEP Service Worker failed to register:", err));
		};

		if (n.serviceWorker) {
			if (window.document.readyState === "loading") {
				window.addEventListener("DOMContentLoaded", registerServiceWorker);
			} else {
				registerServiceWorker();
			}
		}
	})();
}

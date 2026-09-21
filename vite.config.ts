import { defineConfig } from "vite";

// WebCodecs + the MoQ worklets need a cross-origin isolated context
// (SharedArrayBuffer), which requires these headers.
const isolation = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
};

// Allow Cloudflare quick-tunnel hosts (random *.trycloudflare.com each run); the
// leading dot matches the domain and all subdomains.
const allowedHosts = [".trycloudflare.com"];

export default defineConfig({
	// GitHub Pages project site is served under /<repo>/.
	base: "/moq-doom-viewer/",
	server: { headers: isolation, allowedHosts },
	preview: { headers: isolation, allowedHosts },
	build: { target: "esnext" },
});

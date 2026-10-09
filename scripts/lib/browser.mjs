/**
 * 零依赖 CDP（Chrome DevTools Protocol）浏览器驱动
 *
 * 基于 Node 24 原生 WebSocket 直连 Chromium DevTools 协议，
 * 无需 puppeteer/playwright 等第三方依赖。
 * 提供浏览器/页面生命周期管理、控制台与异常捕获、JS 对话框拦截、
 * 视口仿真（移动端/桌面端/任意分辨率）、真实触摸与鼠标事件注入。
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 候选浏览器二进制：环境变量 → puppeteer 缓存 → 系统 Chromium */
function findChromeBinary() {
	if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) {
		return process.env.CHROME_BIN;
	}
	const home = process.env.HOME || "/home";
	const candidates = [
		join(home, ".cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome"),
		join(home, ".cache/puppeteer/chrome/linux-147.0.7778.97/chrome-linux64/chrome"),
		join(home, ".cache/puppeteer/chrome/linux-147.0.7727.57/chrome-linux64/chrome"),
		"/usr/bin/chromium-browser",
		"/usr/bin/chromium",
		"/usr/bin/google-chrome",
	];
	for (const c of candidates) {
		if (existsSync(c)) return c;
	}
	throw new Error("未找到可用的 Chromium/Chrome 浏览器，请设置 CHROME_BIN 环境变量");
}

/** 全局清理登记表：进程退出（含异常/信号）时杀掉浏览器、删除临时目录 */
const cleanupTasks = [];
let cleanupRegistered = false;
function registerCleanup(fn) {
	if (!cleanupRegistered) {
		cleanupRegistered = true;
		const run = async () => {
			for (const fn of cleanupTasks.splice(0)) {
				try {
					await fn();
				} catch {}
			}
		};
		process.once("exit", run);
		for (const sig of ["SIGINT", "SIGTERM", "SIGQUIT"]) {
			process.once(sig, () => {
				run().finally(() => process.exit(0));
			});
		}
	}
	cleanupTasks.push(fn);
}

export async function runCleanup() {
	for (const fn of cleanupTasks.splice(0)) {
		try {
			await fn();
		} catch {}
	}
}

class CDPConnection {
	constructor(ws) {
		this.ws = ws;
		this.seq = 0;
		this.pending = new Map();
		this.handlers = new Map();
		ws.addEventListener("message", ev => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				if (msg.error) reject(new Error(`CDP ${msg.error.message}`));
				else resolve(msg.result);
			} else if (msg.method) {
				this.handlers.get(msg.method)?.(msg.params, msg.sessionId);
			}
		});
	}
	send(method, params = {}, sessionId) {
		const id = ++this.seq;
		const payload = { id, method, params };
		if (sessionId) payload.sessionId = sessionId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify(payload));
			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error(`CDP 调用超时: ${method}`));
				}
			}, 60000).unref?.();
		});
	}
	on(event, handler) {
		this.handlers.set(event, handler);
	}
	close() {
		try {
			this.ws.close();
		} catch {}
	}
}

export class Browser {
	constructor(process, conn, userDataDir) {
		this.process = process;
		this.conn = conn;
		this.userDataDir = userDataDir;
	}
	async newPage() {
		const { targetId } = await this.conn.send("Target.createTarget", { url: "about:blank" });
		const { sessionId } = await this.conn.send("Target.attachToTarget", { targetId, flatten: true });
		return new Page(this, targetId, sessionId);
	}
	async close() {
		try {
			await this.conn.send("Browser.close");
		} catch {}
		this.conn.close();
		// 兜底强杀
		try {
			this.process.kill("SIGKILL");
		} catch {}
		await sleep(300);
		try {
			rmSync(this.userDataDir, { recursive: true, force: true });
		} catch {}
	}
}

export class Page {
	constructor(browser, targetId, sessionId) {
		this.browser = browser;
		this.targetId = targetId;
		this.sessionId = sessionId;
		/** @type {{type:string,text:string,ts:number}[]} */
		this.consoleEntries = [];
		this.jsDialogs = [];
		this.exceptions = [];
		this._dialogHandled = Promise.resolve();
		const s = sessionId;
		const c = browser.conn;

		c.on("Runtime.consoleAPICalled", (p, sid) => {
			if (sid !== s) return;
			this.consoleEntries.push({
				type: p.type,
				text: p.args.map(a => a.value ?? a.description ?? "").join(" "),
				ts: Date.now(),
			});
		});
		c.on("Runtime.exceptionThrown", (p, sid) => {
			if (sid !== s) return;
			this.exceptions.push({
				text: p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "unknown",
				ts: Date.now(),
			});
		});
		c.on("Page.javascriptDialogOpening", async (p, sid) => {
			if (sid !== s) return;
			this.jsDialogs.push({ type: p.type, message: p.message, ts: Date.now() });
			try {
				await c.send("Page.handleJavaScriptDialog", { accept: true }, s);
			} catch {}
		});
		this._conn = c;
	}

	async enable() {
		const s = this.sessionId;
		await this._conn.send("Runtime.enable", {}, s);
		await this._conn.send("Page.enable", {}, s);
		await this._conn.send("Log.enable", {}, s);
		await this._conn.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, s);
	}

	/**
	 * 在页面中执行 JS 表达式（支持 awaitPromise）
	 */
	async evaluate(expression, { awaitPromise = true } = {}) {
		const r = await this._conn.send(
			"Runtime.evaluate",
			{
				expression,
				returnByValue: true,
				awaitPromise,
				allowUnsafeEvalBlockedByCSP: false,
			},
			this.sessionId
		);
		if (r.exceptionDetails) {
			const desc = r.exceptionDetails.exception?.description || r.exceptionDetails.text;
			throw new Error(`页面执行异常: ${desc}\n表达式: ${expression.slice(0, 200)}`);
		}
		return r.result?.value;
	}

	async navigate(url) {
		await this._conn.send("Page.navigate", { url }, this.sessionId);
	}

	/**
	 * 视口仿真（分辨率/移动端/UA）
	 */
	async setViewport(width, height, { mobile = true, deviceScaleFactor = 2, ua } = {}) {
		await this._conn.send(
			"Emulation.setDeviceMetricsOverride",
			{ width, height, deviceScaleFactor, mobile },
			this.sessionId
		);
		if (ua) {
			await this._conn.send(
				"Emulation.setUserAgentOverride",
				{ userAgent: ua, platform: mobile ? "Android" : "Linux x86_64" },
				this.sessionId
			);
		}
	}

	/**
	 * 真实触摸点按（Input 域，走完整浏览器输入管线）
	 */
	async tap(x, y) {
		const s = this.sessionId;
		await this._conn.send(
			"Input.dispatchTouchEvent",
			{ type: "touchStart", touchPoints: [{ x, y, id: 1 }] },
			s
		);
		await sleep(60);
		await this._conn.send(
			"Input.dispatchTouchEvent",
			{ type: "touchEnd", touchPoints: [] },
			s
		);
		await sleep(80);
	}

	/**
	 * 真实触摸滑动（可指定步数，模拟渐进式手势）
	 */
	async swipe(x1, y1, x2, y2, { steps = 8, holdMs = 40 } = {}) {
		const s = this.sessionId;
		await this._conn.send(
			"Input.dispatchTouchEvent",
			{ type: "touchStart", touchPoints: [{ x: x1, y: y1, id: 1 }] },
			s
		);
		await sleep(holdMs);
		for (let i = 1; i <= steps; i++) {
			const x = x1 + ((x2 - x1) * i) / steps;
			const y = y1 + ((y2 - y1) * i) / steps;
			await this._conn.send(
				"Input.dispatchTouchEvent",
				{ type: "touchMove", touchPoints: [{ x, y, id: 1 }] },
				s
			);
			await sleep(24);
		}
		await sleep(holdMs);
		await this._conn.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, s);
		await sleep(60);
	}

	/** 鼠标点击 */
	async click(x, y) {
		const s = this.sessionId;
		for (const type of ["mousePressed", "mouseReleased"]) {
			await this._conn.send(
				"Input.dispatchMouseEvent",
				{ type, x, y, button: "left", clickCount: 1 },
				s
			);
			await sleep(40);
		}
	}

	/** 截图（PNG buffer） */
	async screenshot() {
		const r = await this._conn.send("Page.captureScreenshot", { format: "png" }, this.sessionId);
		return Buffer.from(r.data, "base64");
	}

	async close() {
		try {
			await this._conn.send("Target.closeTarget", { targetId: this.targetId });
		} catch {}
	}
}

/**
 * 启动无头 Chromium 并建立 CDP 连接
 */
export async function launchChrome({ headless = true, extraArgs = [] } = {}) {
	const binary = findChromeBinary();
	const userDataDir = mkdtempSync(join(tmpdir(), "noname-e2e-"));
	const args = [
		headless ? "--headless=new" : "--headless=old",
		"--no-sandbox",
		"--disable-gpu",
		"--disable-dev-shm-usage",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-timer-throttling",
		"--disable-backgrounding-occluded-windows",
		"--mute-audio",
		// 语音模块需要伪造媒体设备（无真实麦克风的无头环境）
		"--use-fake-device-for-media-stream",
		"--use-fake-ui-for-media-stream",
		"--autoplay-policy=no-user-gesture-required",
		"--remote-debugging-port=0",
		`--user-data-dir=${userDataDir}`,
		...extraArgs,
		"about:blank",
	];
	const proc = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });

	let wsUrl = "";
	const stderrBuf = [];
	proc.stderr.on("data", chunk => {
		const text = chunk.toString();
		if (!wsUrl) {
			const m = text.match(/DevTools listening on (ws:\/\/\S+)/);
			if (m) wsUrl = m[1];
		}
	});
	for (let i = 0; i < 100 && !wsUrl; i++) {
		await sleep(100);
	}
	if (!wsUrl) {
		proc.kill("SIGKILL");
		throw new Error("Chrome DevTools 端口启动失败");
	}

	const ws = new WebSocket(wsUrl);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = () => reject(new Error("DevTools WebSocket 连接失败"));
	});

	const browser = new Browser(proc, new CDPConnection(ws), userDataDir);
	registerCleanup(() => browser.close());
	return browser;
}

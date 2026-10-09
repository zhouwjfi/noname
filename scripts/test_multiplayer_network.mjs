/**
 * 模块四：联机大厅、WebSocket 通信与语音状态机测试
 *
 * - 专用测试服务实例（随机高端口、小房间上限）：协议全生命周期回归
 *   （握手/心跳/建房/加入/上限拦截/掉线清理/语音中继）
 * - 真实生产服务（8082）：连接、密钥握手、房间列表（只读，不污染大厅）
 * - 浏览器端：大厅连接、创建房间、语音挂件 UI 点击切换与布局
 */

import { spawn } from "node:child_process";
import { Suite, assert, assertEquals, waitFor } from "./lib/harness.mjs";
import { launchChrome } from "./lib/browser.mjs";
import { bootGame, bridge, consoleErrors, SERVER_WS } from "./lib/helpers.mjs";

const suite = new Suite("模块四：联机大厅与网络协议");

/**
 * 轻量 WebSocket 测试客户端（事件驱动）
 */
class TestClient {
	constructor(ws, name) {
		this.ws = ws;
		this.name = name;
		/** @type {{data: string, json: any, ts: number}[]} */
		this.messages = [];
		this.closed = false;
		ws.addEventListener("message", ev => {
			const data = String(ev.data);
			let json = null;
			try {
				json = JSON.parse(data);
			} catch {}
			this.messages.push({ data, json, ts: Date.now() });
		});
		ws.addEventListener("close", () => (this.closed = true));
	}
	send(...args) {
		this.ws.send(JSON.stringify(args));
	}
	sendRaw(text) {
		this.ws.send(text);
	}
	/** 等待收到满足条件的消息（返回解析后的 JSON 数组） */
	async expect(predicate, { timeout = 5000, label = "消息" } = {}) {
		return await waitFor(
			() => {
				const hit = this.messages.find(m => m.json && predicate(m.json));
				return hit ? hit.json : false;
			},
			{ timeout, interval: 80, label }
		);
	}
	waitForType(type, opts) {
		return this.expect(arr => arr[0] === type, { label: `消息 ${type}`, ...opts });
	}
	close() {
		try {
			this.ws.close();
		} catch {}
	}
}

async function connectTestClient(url, { name = "client" } = {}) {
	const ws = new WebSocket(url);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = () => reject(new Error(`${name}: WebSocket 连接失败 ${url}`));
	});
	return new TestClient(ws, name);
}

/** 启动专用联机测试服务实例 */
async function spawnTestServer() {
	const port = 18200 + Math.floor(Math.random() * 500);
	const proc = spawn(process.execPath, ["packages/server/dist/cli.cjs", "--port", String(port), "--max-rooms", "3"], {
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	});
	let listening = false;
	proc.stderr.on("data", d => process.stderr.write(`[test-server] ${d}`));
	proc.stdout.on("data", d => {
		const s = String(d);
		if (s.includes("listening")) listening = true;
	});
	await waitFor(() => listening, { timeout: 10000, interval: 100, label: "测试联机服务启动" });
	const url = `ws://127.0.0.1:${port}`;
	return { proc, url, port, close: () => proc.kill("SIGKILL") };
}

suite.test("WebSocket 握手：连接即推房间列表，密钥握手解除超时拦截", async () => {
	const server = await spawnTestServer();
	try {
		const client = await connectTestClient(server.url, { name: "handshake" });
		// 连接建立即收到 roomlist（含 wsid）
		const roomlist = await client.waitForType("roomlist", { timeout: 5000 });
		assert(Array.isArray(roomlist[1]), "roomlist 房间列表格式错误");
		assert(Array.isArray(roomlist[3]), "roomlist 在线列表格式错误");
		assert(typeof roomlist[4] === "string" && roomlist[4].length >= 9, "roomlist 缺少 wsid");

		// 未在 2 秒内发送密钥将被拒：先验证发 key 后可存活
		client.send("server", "key", ["test-online-key-abc"]);
		await new Promise(r => setTimeout(r, 2600)); // 跨过 2s 看门狗
		const denied = client.messages.find(m => m.json && m.json[0] === "denied");
		assert(!denied, `发送密钥后仍被拒绝: ${denied?.data}`);
		assert(!client.closed, "发送密钥后连接仍被关闭");

		// 不发密钥的连接应被 2s 看门狗拒掉
		const lazy = await connectTestClient(server.url, { name: "lazy" });
		await lazy.expect(arr => arr[0] === "denied", { timeout: 4000, label: "懒连接被拒(denied)" });
		await waitFor(() => lazy.closed, { timeout: 3000, label: "懒连接被关闭" });
		client.close();
		lazy.close();
	} finally {
		server.close();
	}
});

suite.test("房间生命周期：创建/配置/加入/列表刷新/掉线清理", async () => {
	const server = await spawnTestServer();
	try {
		const owner = await connectTestClient(server.url, { name: "owner" });
		owner.send("server", "key", ["owner-key"]);
		await owner.waitForType("roomlist", { timeout: 4000 });

		// 创建房间（服务端 create 不落配置，房主需随后发送 config 消息——真实客户端在 waitForPlayer 中完成）
		const roomConfig = { mode: "identity", gameStarted: false };
		owner.send("server", "create", "owner-key", "房主甲", "caocao", roomConfig, "identity");
		await owner.waitForType("createroom", { timeout: 4000 });
		owner.send("server", "config", roomConfig);
		await new Promise(r => setTimeout(r, 300));
		assertEquals(owner.messages.find(m => m.json?.[0] === "createroom")?.json?.[1], "owner-key");

		// 大厅观察者先连接（未入房，用于验证 updaterooms 广播）
		const watcher = await connectTestClient(server.url, { name: "watcher" });
		watcher.send("server", "key", ["watcher-key"]);
		await watcher.waitForType("roomlist", { timeout: 4000 });

		// 第二名玩家加入
		const guest = await connectTestClient(server.url, { name: "guest" });
		guest.send("server", "key", ["guest-key"]);
		await guest.waitForType("roomlist", { timeout: 4000 });
		guest.send("server", "enter", "owner-key", "玩家乙", "sunquan");
		// 房主收到 onconnection 通知
		await owner.waitForType("onconnection", { timeout: 4000 });

		// 房间列表刷新：入房变化触发未入房成员收到 updaterooms
		const update = await watcher.waitForType("updaterooms", { timeout: 4000 });
		const rooms = update[1];
		assert(rooms.length === 1, `房间列表应含 1 个房间，实际 ${rooms.length}`);
		const entry = rooms[0];
		assertEquals(entry[0], "房主甲", "房间列表房主昵称错误");
		assert(typeof entry[3] === "number" && entry[3] >= 1, `房间人数统计错误: ${entry[3]}`);

		// 房主掉线 → 房间销毁 + 成员收到 selfclose + 大厅（未入房者）收到 updaterooms
		owner.close();
		await guest.waitForType("selfclose", { timeout: 5000 });
		await waitFor(() => watcher.messages.some(m => m.json?.[0] === "updaterooms"), {
			timeout: 4000,
			label: "掉线后房间清理广播（大厅侧）",
		});
		guest.close();
		watcher.close();
	} finally {
		server.close();
	}
});

suite.test("房间数量上限拦截（max-rooms=3，第 4 个被拒）", async () => {
	const server = await spawnTestServer();
	try {
		const owners = [];
		for (let i = 0; i < 3; i++) {
			const c = await connectTestClient(server.url, { name: `owner${i}` });
			c.send("server", "key", [`key-${i}`]);
			await c.waitForType("roomlist", { timeout: 4000 });
			c.send("server", "create", `key-${i}`, `房主${i}`, "caocao", { mode: "identity" }, "identity");
			await c.waitForType("createroom", { timeout: 4000 });
			owners.push(c);
		}
		// 第 4 个房间应被拦截
		const fourth = await connectTestClient(server.url, { name: "owner3" });
		fourth.send("server", "key", ["key-3"]);
		await fourth.waitForType("roomlist", { timeout: 4000 });
		fourth.send("server", "create", "key-3", "房主3", "caocao", { mode: "identity" }, "identity");
		const failed = await fourth.waitForType("createroomfailed", { timeout: 4000 });
		assert(String(failed[1]).includes("上限"), `上限拦截提示异常: ${failed[1]}`);
		owners.forEach(c => c.close());
		fourth.close();
	} finally {
		server.close();
	}
});

suite.test("房间内语音消息中继（单跳直达）", async () => {
	const server = await spawnTestServer();
	try {
		const owner = await connectTestClient(server.url, { name: "voice-owner" });
		owner.send("server", "key", ["vo-key"]);
		await owner.waitForType("roomlist", { timeout: 4000 });
		owner.send("server", "create", "vo-key", "语音房主", "caocao", { mode: "identity" }, "identity");
		await owner.waitForType("createroom", { timeout: 4000 });
		owner.send("server", "config", { mode: "identity", gameStarted: false });
		await new Promise(r => setTimeout(r, 300));

		const guest = await connectTestClient(server.url, { name: "voice-guest" });
		guest.send("server", "key", ["vg-key"]);
		await guest.waitForType("roomlist", { timeout: 4000 });
		guest.send("server", "enter", "vo-key", "语音玩家", "sunquan");
		await owner.waitForType("onconnection", { timeout: 4000 });

		// 成员发送语音状态 → 房主收到中继 ["voice", wsid, payload]
		guest.send("server", "voice", { type: "state", speaking: true });
		const relayed = await owner.waitForType("voice", { timeout: 4000 });
		assert(relayed[2] && relayed[2].type === "state" && relayed[2].speaking === true, `语音中继内容异常: ${relayed[2]}`);

		owner.close();
		guest.close();
	} finally {
		server.close();
	}
});

suite.test("真实服务（8082）：连接、密钥握手与房间列表（只读）", async () => {
	const client = await connectTestClient(SERVER_WS, { name: "prod" });
	const roomlist = await client.waitForType("roomlist", { timeout: 5000 });
	assert(Array.isArray(roomlist[1]), "生产服务房间列表格式错误");
	client.send("server", "key", ["e2e-probe-key"]);
	await new Promise(r => setTimeout(r, 2500));
	const denied = client.messages.find(m => m.json && m.json[0] === "denied");
	assert(!denied, `生产服务密钥握手被拒: ${denied?.data}`);
	assert(!client.closed, "生产服务握手后连接被异常关闭");
	client.close();
});

suite.test("浏览器端：大厅自动连接本地服务、建房与语音挂件 UI", async () => {
	const server = await spawnTestServer();
	const browser = await launchChrome();
	try {
		// 大厅指向专用测试服务，避免污染生产大厅
		const page = await bootGame(browser, {
			mobile: true,
			width: 412,
			height: 915,
			query: `hall=${encodeURIComponent(server.url)}`,
			offline: false,
		});
		// 联机模式自动连接
		const online = await waitFor(
			async () => await bridge(page, `!!game.online && !!game.wsid`),
			{ timeout: 20000, interval: 500, label: "大厅 WebSocket 连接" }
		);
		assert(online, "未能建立大厅连接");

		// 房间列表 UI 出现
		await waitFor(
			async () => await page.evaluate(`!!(window.__noname_test__.ui.rooms || window.__noname_test__.ui.createRoomButton)`),
			{ timeout: 10000, interval: 400, label: "大厅房间列表 UI" }
		);

		// 通过协议创建房间（与 UI 创建等效，但更稳定），客户端进入房间界面。
		// lib.configOL.mode 正常由建房菜单设置，协议直连时需预先指定
		await bridge(page, `(function(){
			const { game, lib } = window.__noname_test__;
			lib.configOL.mode = 'identity';
			game.send('server', 'create', game.onlineKey, 'E2E房主', lib.config.connect_avatar || 'caocao', {
				mode: 'identity', gameStarted: false, num: 2
			}, 'identity');
			return true;
		})()`);
		// 等待房间视图（语音挂件在房间内创建）
		const voiceDockVisible = await waitFor(
			async () => await page.evaluate(`(function(){
				const dock = document.getElementById('voice-dock');
				if (!dock) return false;
				const r = dock.getBoundingClientRect();
				return r.width > 10 && r.height > 10;
			})()`),
			{ timeout: 15000, interval: 500, label: "房间内语音挂件出现" }
		);
		assert(voiceDockVisible, "语音挂件未出现");

		// 语音挂件：麦克风/扬声器按钮点击切换，无文字断行与布局错位
		const voiceUI = await page.evaluate(`(function(){
			const dock = document.getElementById('voice-dock');
			const mic = dock.querySelector('.voice-btn-mic');
			const speaker = dock.querySelector('.voice-btn-speaker');
			return {
				micRect: mic ? mic.getBoundingClientRect().toJSON() : null,
				speakerRect: speaker ? speaker.getBoundingClientRect().toJSON() : null,
				dockRect: dock.getBoundingClientRect().toJSON(),
				micTitle: mic ? mic.title : null,
				speakerTitle: speaker ? speaker.title : null,
			};
		})()`);
		assert(voiceUI.micRect && voiceUI.speakerRect, "语音按钮缺失");

		// 扬声器切换（不依赖麦克风权限）
		await page.tap(voiceUI.speakerRect.x + voiceUI.speakerRect.width / 2, voiceUI.speakerRect.y + voiceUI.speakerRect.height / 2);
		await new Promise(r => setTimeout(r, 500));
		const speakerState = await bridge(page, `({ deafened: game.voice ? game.voice.deafened : null, title: document.querySelector('#voice-dock .voice-btn-speaker') ? document.querySelector('#voice-dock .voice-btn-speaker').title : null })`);
		assert(speakerState.deafened === true, `扬声器切换失效: ${JSON.stringify(speakerState)}`);

		// 麦克风切换（headless fake media device 已启用）
		await page.tap(voiceUI.micRect.x + voiceUI.micRect.width / 2, voiceUI.micRect.y + voiceUI.micRect.height / 2);
		await new Promise(r => setTimeout(r, 800));
		const micState = await bridge(page, `({ muted: game.voice ? game.voice.muted : null, title: document.querySelector('#voice-dock .voice-btn-mic') ? document.querySelector('#voice-dock .voice-btn-mic').title : null })`);
		assert(micState.muted === false, `麦克风开启失败: ${JSON.stringify(micState)}`);
		// 再切回闭麦
		const micRect2 = await page.evaluate(`document.querySelector('#voice-dock .voice-btn-mic').getBoundingClientRect().toJSON()`);
		await page.tap(micRect2.x + micRect2.width / 2, micRect2.y + micRect2.height / 2);
		await new Promise(r => setTimeout(r, 500));
		const micState2 = await bridge(page, `game.voice.muted`);
		assert(micState2 === true, "麦克风关闭失败");

		// 布局校验：按钮无文字断行（scrollWidth 不超 clientWidth）且都在视口内
		const layoutCheck = await page.evaluate(`(function(){
			const dock = document.getElementById('voice-dock');
			const problems = [];
			for (const btn of dock.children) {
				if (btn.scrollWidth > btn.clientWidth + 2) problems.push('断行: ' + btn.className);
				const r = btn.getBoundingClientRect();
				if (r.left < 0 || r.right > window.innerWidth || r.top < 0 || r.bottom > window.innerHeight) {
					problems.push('越界: ' + btn.className);
				}
			}
			const dr = dock.getBoundingClientRect();
			if (dr.right > window.innerWidth + 2 || dr.bottom > window.innerHeight + 2) problems.push('挂件越界');
			return problems;
		})()`);
		assert(layoutCheck.length === 0, `语音挂件布局异常: ${layoutCheck.join("; ")}`);

		// 全程零错误
		const errors = consoleErrors(page);
		assert(errors.length === 0, `联机流程存在错误: ${errors.slice(0, 5).join(" | ").slice(0, 400)}`);
		await page.close();
	} finally {
		await browser.close();
		server.close();
	}
});

const results = await suite.run();
process.exitCode = results.every(r => r.ok) ? 0 : 1;

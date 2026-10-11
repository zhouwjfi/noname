/**
 * E2E：无刷新退出房间回归测试
 *
 * 场景1（房主）：大厅连接测试服 → 协议建房（身份场）→ 等待房间 → leaveRoom()
 *   → 必须原地回到大厅，且绝不自动开局（回归：等待房间僵尸链被 forceOver 唤醒后补AI自动开身份场）
 * 场景2（客机）：房主建房，客机进房 → 房主离开 → 客机收到 roomlist 被动回大厅，同样不得自动开局
 *
 * 运行：node scripts/test_leave_room_e2e.mjs
 */

import { spawn } from "node:child_process";
import { Suite, assert, waitFor } from "./lib/harness.mjs";
import { launchChrome } from "./lib/browser.mjs";
import { bootGame, bridge } from "./lib/helpers.mjs";

const suite = new Suite("无刷新退出房间 E2E");

async function spawnTestServer() {
	const port = 19200 + Math.floor(Math.random() * 500);
	const proc = spawn(process.execPath, ["packages/server/dist/cli.cjs", "--port", String(port), "--max-rooms", "3"], {
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	});
	let listening = false;
	proc.stdout.on("data", d => {
		if (String(d).includes("listening")) listening = true;
	});
	proc.stderr.on("data", d => process.stderr.write(`[test-server] ${d}`));
	await waitFor(() => listening, { timeout: 10000, interval: 100, label: "测试联机服务启动" });
	return { proc, url: `ws://127.0.0.1:${port}`, close: () => proc.kill("SIGKILL") };
}

/** 建一个身份场身份房并等待房主进入等待房间 */
async function createIdentityRoom(page) {
	await bridge(page, `(function(){
		const { game, lib } = window.__noname_test__;
		lib.configOL.mode = 'identity';
		game.send('server', 'create', game.onlineKey, 'E2E房主', lib.config.connect_avatar || 'caocao', {
			mode: 'identity', gameStarted: false, player_number: 5
		}, 'identity');
		return true;
	})()`);
	await waitFor(
		async () => await bridge(page, `_status.waitingForPlayer === true`),
		{ timeout: 20000, interval: 400, label: "房主进入等待房间" }
	);
}

const HALL_READY = `(function(){ const { ui, game } = window.__noname_test__; return !!(game.onlinehall && (ui.rooms || ui.createRoomButton)); })()`;

suite.test("房主从等待房间退出：回到大厅且不自动开局", async () => {
	const server = await spawnTestServer();
	const browser = await launchChrome();
	try {
		const page = await bootGame(browser, {
			width: 1280,
			height: 800,
			query: `hall=${encodeURIComponent(server.url)}`,
			offline: false,
		});
		await waitFor(async () => await bridge(page, `!!game.online && !!game.wsid`), {
			timeout: 20000,
			interval: 500,
			label: "大厅连接建立",
		});

		await createIdentityRoom(page);
		const pre = await bridge(page, `({ players: game.players.length, roomId: game.roomId, waiting: _status.waitingForPlayer })`);
		assert(pre.players === 0, `进房即有玩家? ${JSON.stringify(pre)}`);

		// 无刷新主动离房（与点击"退出房间"等效）
		await bridge(page, `lib.message.client.leaveRoom()`);

		// 回归断言：2~10秒内不得自动开局（旧bug：等待房间僵尸链被唤醒后补4个AI开局）
		await new Promise(r => setTimeout(r, 8000));
		const mid = await bridge(page, `({ players: game.players.length, me: !!game.me, waiting: _status.waitingForPlayer, phase: _status.event && _status.event.name })`);
		assert(mid.players === 0, `离房后自动开局了！players=${mid.players}, event=${mid.phase}`);
		assert(!mid.me, "离房后 game.me 被创建（开局迹象）");
		assert(!mid.waiting, "离房后仍处于等待房间状态");

		await waitFor(async () => await bridge(page, HALL_READY), {
			timeout: 10000,
			interval: 400,
			label: "回到联机大厅",
		});
		const post = await bridge(page, `({ onlineroom: game.onlineroom, servermode: game.servermode, roomId: game.roomId, online: game.online, hall: game.onlinehall, wsOpen: game.ws && game.ws.readyState === 1 })`);
		assert(post.onlineroom === false, "onlineroom 未复位");
		assert(post.servermode === false, "servermode 未复位");
		assert(post.online === true && post.hall === true, "未回到大厅在线状态");
		assert(post.wsOpen === true, "WebSocket 连接未保留");
		page.close();
	} finally {
		server.close();
		await browser.close();
	}
});

suite.test("房主离开后客机被动回大厅：不自动开局", async () => {
	const server = await spawnTestServer();
	const browser = await launchChrome();
	try {
		const owner = await bootGame(browser, {
			width: 1280,
			height: 800,
			query: `hall=${encodeURIComponent(server.url)}`,
			offline: false,
		});
		await waitFor(async () => await bridge(owner, `!!game.online && !!game.wsid`), {
			timeout: 20000,
			interval: 500,
			label: "房主大厅连接",
		});
		const roomId = await bridge(owner, `(function(){
			const { game, lib } = window.__noname_test__;
			lib.configOL.mode = 'identity';
			game.send('server', 'create', game.onlineKey, 'E2E房主', lib.config.connect_avatar || 'caocao', {
				mode: 'identity', gameStarted: false, player_number: 5
			}, 'identity');
			return game.onlineKey;
		})()`);

		const guest = await bootGame(browser, {
			width: 1280,
			height: 800,
			query: `hall=${encodeURIComponent(server.url)}`,
			offline: false,
		});
		await waitFor(async () => await bridge(guest, `!!game.online && !!game.wsid`), {
			timeout: 20000,
			interval: 500,
			label: "客机大厅连接",
		});
		await bridge(guest, `(function(){
			const { game } = window.__noname_test__;
			game.send('server', 'enter', ${JSON.stringify(roomId)}, 'E2E客机', lib.config.connect_avatar || 'caocao');
			return true;
		})()`);
		// 等客机真正进入房间（房主 init 会带 roomId 且等待期 servermode 恒为 false）
		await waitFor(
			async () => await bridge(guest, `typeof game.roomId === 'string' && game.roomId === ${JSON.stringify(roomId)} && !!game.onlineID`),
			{ timeout: 20000, interval: 400, label: "客机进入房间" }
		);

		// 房主无刷新离开 → 房间销毁 → 客机收到 roomlist
		await bridge(owner, `lib.message.client.leaveRoom()`);

		await new Promise(r => setTimeout(r, 8000));
		const gMid = await bridge(guest, `({ players: game.players.length, me: !!game.me, phase: _status.event && _status.event.name })`);
		assert(gMid.players === 0, `客机被踢后自动开局了！players=${gMid.players}, event=${gMid.phase}`);
		assert(!gMid.me, "客机被踢后 game.me 被创建");

		await waitFor(async () => await bridge(guest, HALL_READY), {
			timeout: 10000,
			interval: 400,
			label: "客机回到大厅",
		});
		const gPost = await bridge(guest, `({ onlineroom: game.onlineroom, servermode: game.servermode, online: game.online, roomId: game.roomId, wsOpen: game.ws && game.ws.readyState === 1 })`);
		assert(gPost.servermode === false && gPost.onlineroom === false, "客机房间态未复位");
		assert(gPost.roomId === null, "客机 roomId 未清空");
		assert(gPost.wsOpen === true, "客机 WebSocket 连接未保留");
		owner.close();
		guest.close();
	} finally {
		server.close();
		await browser.close();
	}
});

const results = await suite.run();
process.exitCode = results.every(r => r.ok) ? 0 : 1;

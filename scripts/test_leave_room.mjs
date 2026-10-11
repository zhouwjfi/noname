// 零依赖 WebSocket 协议测试：验证房间主动离房（leave）协议
// 用法: node scripts/test_leave_room.mjs [ws://host:port]
//   不传地址时自动起一个随机端口的测试实例；传入地址则直接测试该实例
// 覆盖: 客机离房(房主收onclose、离房者收roomlist)、房主离房销毁房间(成员收roomlist)、大厅离房无副作用
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
const WebSocket = (() => {
	try {
		return require(process.env.WS_MODULE || "ws");
	} catch {
		return require("../packages/server/node_modules/ws");
	}
})();

const URL = process.argv[2] || "ws://127.0.0.1:8082";
const results = [];
const check = (name, cond) => {
	results.push([name, !!cond]);
	console.log(`${cond ? "✓" : "✗"} ${name}`);
};

const connect = () =>
	new Promise((resolve, reject) => {
		const ws = new WebSocket(URL);
		const state = { messages: [], waiters: [] };
		ws.on("open", () => resolve(state));
		ws.on("error", reject);
		ws.on("message", raw => {
			const str = raw.toString();
			if (str === "heartbeat") {
				ws.send("heartbeat");
				return;
			}
			let msg;
			try {
				msg = JSON.parse(str);
			} catch {
				return;
			}
			const index = state.messages.length;
			state.messages.push(msg);
			state.waiters = state.waiters.filter(w => {
				if (index >= w.since && w.pred(msg)) {
					w.resolve(msg);
					return false;
				}
				return true;
			});
		});
		state.send = (...args) => ws.send(JSON.stringify(args));
		// 只等待 since 之后的新消息，避免命中历史缓冲里的旧消息
		state.wait = (pred, since = 0) =>
			new Promise(resolve => {
				for (let i = since; i < state.messages.length; i++) {
					if (pred(state.messages[i])) return resolve(state.messages[i]);
				}
				state.waiters.push({ pred, resolve, since });
			});
		state.ws = ws;
	});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 未指定地址时自起测试实例 */
async function spawnTestServer() {
	const port = 19700 + Math.floor(Math.random() * 200);
	const proc = spawn(process.execPath, ["packages/server/dist/cli.cjs", "--port", String(port), "--max-rooms", "5"], {
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	});
	let listening = false;
	proc.stdout.on("data", d => {
		if (String(d).includes("listening")) listening = true;
	});
	await new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error("测试服务启动超时")), 10000);
		const iv = setInterval(() => {
			if (listening) {
				clearTimeout(t);
				clearInterval(iv);
				resolve();
			}
		}, 100);
	});
	return { url: `ws://127.0.0.1:${port}`, close: () => proc.kill("SIGKILL") };
}

const run = async () => {
	let server = null;
	let URL = process.argv[2];
	if (!URL) {
		server = await spawnTestServer();
		URL = server.url;
		console.log(`（自起测试实例 ${URL}）`);
	}
	try {
	// 房主连接
	const ownerKey = "testkey-owner-" + Date.now();
	const owner = await connect();
	owner.send("server", "key", [ownerKey, "1.0"]);
	await sleep(300);
	owner.send("server", "create", ownerKey, "房主", "caocao");
	const createroom = await owner.wait(m => m[0] === "createroom");
	const roomId = createroom[1];
	check("房主创建房间成功", typeof roomId === "string" && roomId.length > 0);
	// 模拟房主进入等待房间时上报房间配置（服务端 enter 校验 room.config 存在）
	owner.send("server", "config", { gameStarted: false, observe: true, observeReady: false });
	await sleep(200);

	// 客机连接并进入房间
	const guestKey = "testkey-guest-" + Date.now();
	const guest = await connect();
	guest.send("server", "key", [guestKey, "1.0"]);
	await sleep(300);
	guest.send("server", "enter", roomId, "客机", "caocao");
	await owner.wait(m => m[0] === "onconnection");
	check("房主收到 onconnection", true);

	// --- 场景1: 客机主动离房 ---
	// 快照必须在触发之前：服务端可能先发 onclose 再发 roomlist
	const gFrom = guest.messages.length;
	const oFrom = owner.messages.length;
	guest.send("server", "leave");
	const guestRoomlist = await guest.wait(m => m[0] === "roomlist", gFrom);
	check("客机离房后收到 roomlist", Array.isArray(guestRoomlist[1]));
	const ownerOnclose = await owner.wait(m => m[0] === "onclose", oFrom);
	check("房主收到客机 onclose 通知", ownerOnclose[1] !== undefined);
	const ownerVoiceLeft = await owner.wait(m => m[0] === "voice" && m[2] && m[2].left, oFrom);
	check("房主收到客机语音离开状态", ownerVoiceLeft !== undefined);
	// 客机保留连接：再发一次消息应正常响应
	guest.send("server", "status", "idle");
	await sleep(300);
	check("客机离房后连接仍可用（未断开）", guest.ws.readyState === WebSocket.OPEN);

	// 客机重新进房（为场景2做准备）
	const oFrom2 = owner.messages.length;
	guest.send("server", "enter", roomId, "客机", "caocao");
	await owner.wait(m => m[0] === "onconnection", oFrom2);

	// --- 场景2: 房主主动离房（销毁房间，成员保留连接） ---
	const gFrom2 = guest.messages.length;
	const oFrom3 = owner.messages.length;
	owner.send("server", "leave");
	const ownerRoomlist = await owner.wait(m => m[0] === "roomlist", oFrom3);
	check("房主离房后收到 roomlist", Array.isArray(ownerRoomlist[1]));
	const guestRoomlist2 = await guest.wait(m => m[0] === "roomlist", gFrom2);
	check("成员在房主离房后收到 roomlist", Array.isArray(guestRoomlist2[1]));
	// 房间应从列表消失
	const roomsInList = guestRoomlist2[1].filter(r => r && r[4] === roomId);
	check("销毁的房间不再出现在房间列表", roomsInList.length === 0);
	check("成员连接仍可用", guest.ws.readyState === WebSocket.OPEN);
	check("房主连接仍可用", owner.ws.readyState === WebSocket.OPEN);

	// --- 场景3: 大厅状态发 leave 应无副作用（不崩溃、连接保留） ---
	guest.send("server", "leave");
	await sleep(300);
	check("大厅状态发 leave 无副作用", guest.ws.readyState === WebSocket.OPEN);

	owner.ws.close();
	guest.ws.close();
	await sleep(200);

	const failed = results.filter(([, ok]) => !ok);
	console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
	process.exitCode = failed.length ? 1 : 0;
	} finally {
		if (server) server.close();
	}
};

run().catch(e => {
	console.error("测试失败:", e);
	process.exit(1);
});

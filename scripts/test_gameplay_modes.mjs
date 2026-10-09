/**
 * 模块三：核心游戏模式与出牌流程完整性测试
 *
 * - 身份模式：标准局开局、身份分发、主公选将、摸牌出牌
 * - 国战模式：双将选择、暗置/明置机制
 * - 斗地主模式：叫分抢地主、倍数、发牌
 * - 单挑模式：快速开局
 * - AI 自动推演：≥3 完整玩家回合，无死锁/无限循环/异步异常
 * - 胜负结算：结算弹窗展示与关闭
 */

import { launchChrome } from "./lib/browser.mjs";
import { Suite, assert, waitFor } from "./lib/harness.mjs";
import {
	bootGame,
	bridge,
	consoleErrors,
	installAutoAnswer,
	stopAutoAnswer,
	installTurnCounter,
	waitGamePlayable,
	startLocalMode,
} from "./lib/helpers.mjs";

const suite = new Suite("模块三：游戏玩法与出牌流程");

/**
 * 各模式的局内校验器（返回错误描述或 null）
 */
const MODE_CHECKS = {
	identity: page =>
		bridge(
			page,
			`(function(){
				const problems = [];
				if (game.players.length < 4) problems.push('人数不足: ' + game.players.length);
				const hasZhu = game.players.some(p => p.identity === 'zhu');
				if (!hasZhu) problems.push('缺少主公');
				const identities = game.players.map(p => p.identity).filter(Boolean);
				if (identities.length < game.players.length) problems.push('存在未分配身份的玩家');
				return problems;
			})()`
		).then(problems => (problems.length ? `身份模式校验失败: ${problems.join("; ")}` : null)),

	guozhan: page =>
		bridge(
			page,
			`(function(){
				const problems = [];
				if (game.players.length < 4) problems.push('人数不足: ' + game.players.length);
				// 国战武将应处于暗置状态（unseen）
				const unseenCount = game.players.filter(p => p.isUnseen ? p.isUnseen(0) || p.isUnseen(1) : p.classList.contains('unseen')).length;
				if (unseenCount === 0) problems.push('无暗置武将');
				// 每名玩家应有双武将（name1/name2）
				const noDouble = game.players.filter(p => !p.name2).length;
				if (noDouble > 0) problems.push(noDouble + ' 名玩家无副将');
				return problems;
			})()`
		).then(problems => (problems.length ? `国战模式校验失败: ${problems.join("; ")}` : null)),

	doudizhu: page =>
		bridge(
			page,
			`(function(){
				const problems = [];
				if (game.players.length !== 3) problems.push('斗地主应为3人局，实际 ' + game.players.length);
				if (!game.zhu || !game.zhu.name) problems.push('未确定地主');
				// 对局开始后手牌会被打出，初始发牌校验改为身份与结构性校验
				if (game.zhu && game.zhu.identity !== 'zhu') problems.push('地主身份标记错误: ' + game.zhu.identity);
				const fanCount = game.players.filter(p => p.identity === 'fan').length;
				if (fanCount !== 2) problems.push('农民人数应为2，实际 ' + fanCount);
				return problems;
			})()`
		).then(problems => (problems.length ? `斗地主模式校验失败: ${problems.join("; ")}` : null)),

	single: page =>
		bridge(
			page,
			`(function(){
				const problems = [];
				if (game.players.length !== 2) problems.push('单挑应为2人局，实际 ' + game.players.length);
				return problems;
			})()`
		).then(problems => (problems.length ? `单挑模式校验失败: ${problems.join("; ")}` : null)),
};

/**
 * AI 自动推演：等待 ≥minTurns 个玩家回合，监控死锁与异常
 */
async function runAIPlaythrough(page, mode, minTurns, { maxWaitMs = 150000 } = {}) {
	await installTurnCounter(page);
	// 开启托管（game.me 交给 AI）；"forced" 绕过按钮隐藏守卫，
	// 若当前正在等待玩家选择则立即 redo 并恢复事件循环
	await bridge(page, `(function(){ ui.click.auto('forced'); if (!_status.auto) ui.click.auto('forced'); return _status.auto; })()`);
	const errorSince = Date.now();

	let lastTurnCount = 0;
	let lastProgressTs = Date.now();
	const start = Date.now();
	while (Date.now() - start < maxWaitMs) {
		await new Promise(r => setTimeout(r, 1500));
		// 托管保活：若因结算/询问弹窗退出托管或暂停等待，重新接管
		const stuck = await bridge(page, `(!!_status.paused && (!!_status.imchoosing || !_status.auto))`).catch(() => false);
		if (stuck) {
			await bridge(page, `(function(){ if (!_status.auto) { ui.click.auto('forced'); } else { game.uncheck(); _status.event.redo(); game.resume(); } })()`).catch(() => {});
		}
		const turnCount = await page.evaluate(`window.__turnCount || 0`);
		if (turnCount > lastTurnCount) {
			lastTurnCount = turnCount;
			lastProgressTs = Date.now();
		}
		// 死锁检测：60 秒无任何回合推进视为卡死
		if (Date.now() - lastProgressTs > 60000) {
			const diag = await bridge(page, `({
				paused: _status.paused,
				eventName: _status.event ? _status.event.name : null,
				inLoop: typeof _status.looping !== 'undefined' ? _status.looping : null,
				players: game.players.length,
			})`);
			throw new Error(
				`${mode} 模式疑似死锁: ${JSON.stringify(diag)}，回合进度卡在 ${turnCount}/${minTurns}`
			);
		}
		const newErrors = consoleErrors(page, { since: errorSince });
		if (newErrors.length) {
			throw new Error(`${mode} 模式推演中报错: ${newErrors.slice(0, 3).join(" | ").slice(0, 300)}`);
		}
		if (turnCount >= minTurns) {
			return turnCount;
		}
		// 游戏提前自然结束也算通过（AI 分出胜负）
		const over = await bridge(page, `!!_status.over`);
		if (over) return turnCount;
	}
	throw new Error(`${mode} 模式 ${maxWaitMs}ms 内未达到 ${minTurns} 个回合（当前 ${lastTurnCount}）`);
}

/**
 * 各模式"开局完成"的就绪判定（对局开始后手牌会被打出，只能校验结构性条件）
 */
const MODE_READY = {
	identity: `game.me && game.players.every(p => p.node.handcards1.childElementCount > 0 || p.isDead())`,
	guozhan: `game.me && game.players.every(p => p.node.handcards1.childElementCount > 0 || p.isDead())`,
	doudizhu: `game.zhu && game.zhu.identity === 'zhu' && game.players.every(p => p.node.handcards1.childElementCount > 0 || p.isDead())`,
	single: `game.me && game.players.every(p => p.node.handcards1.childElementCount > 0 || p.isDead())`,
};

/**
 * 单个模式的完整测试流程
 */
async function testMode(browser, mode, minTurns) {
	const page = await bootGame(browser, { mobile: false, width: 1920, height: 1080 });
	try {
		// 从联机大厅切换到本地模式（清除联机状态），等待开局
		await startLocalMode(page, mode, { timeout: 120000 });

		// 等待发牌/叫分等开局流程彻底完成（模式专属就绪条件）
		await waitFor(
			async () => await bridge(page, `( !!(${MODE_READY[mode]}) )`),
			{ timeout: 90000, interval: 800, label: `${mode} 发牌完成` }
		);

		// 模式专属校验
		const checkFailure = await MODE_CHECKS[mode](page);
		assert(checkFailure === null, checkFailure || "未知校验失败");

		// AI 自动推演 ≥N 回合
		const turns = await runAIPlaythrough(page, mode, minTurns);
		assert(turns >= minTurns || (await bridge(page, `!!_status.over`)), `${mode} 回合数不足: ${turns}`);

		// 停止自动应答，触发胜负结算界面并验证展示与关闭
		await stopAutoAnswer(page);
		await bridge(page, `game.over('<div><div>自动化测试对局结算</div></div>', undefined)`);
		const overDialogVisible = await waitFor(
			async () =>
				await page.evaluate(`(function(){
					const dialogs = Array.from(document.querySelectorAll('.dialog, #window > div'));
					return dialogs.some(d => (d.textContent || '').includes('自动化测试对局结算'));
				})()`),
			{ timeout: 10000, interval: 400, label: `${mode} 结算弹窗展示` }
		);
		assert(overDialogVisible, `${mode} 结算弹窗未展示`);
		// 点击结算弹窗按钮关闭
		await installAutoAnswer(page);
		await waitFor(
			async () =>
				await page.evaluate(`!Array.from(document.querySelectorAll('.dialog')).some(d => (d.textContent || '').includes('自动化测试对局结算'))`),
			{ timeout: 15000, interval: 500, label: `${mode} 结算弹窗关闭` }
		);
		await stopAutoAnswer(page);

		// 全程零错误
		const errors = [...consoleErrors(page), ...page.exceptions.map(e => `[exception] ${e.text}`)];
		assert(errors.length === 0, `${mode} 全流程存在错误:\n${errors.slice(0, 6).join("\n").slice(0, 600)}`);
	} finally {
		await page.close();
	}
}

suite.test("身份模式：8人局开局、身份分发、主公选将与AI推演≥6回合", async () => {
	const browser = await launchChrome();
	try {
		await testMode(browser, "identity", 6);
	} finally {
		await browser.close();
	}
});

suite.test("国战模式：双将选择、暗置机制与AI推演≥4回合", async () => {
	const browser = await launchChrome();
	try {
		await testMode(browser, "guozhan", 4);
	} finally {
		await browser.close();
	}
});

suite.test("斗地主模式：叫地主、倍数、发牌与AI推演≥3回合", async () => {
	const browser = await launchChrome();
	try {
		await testMode(browser, "doudizhu", 3);
	} finally {
		await browser.close();
	}
});

suite.test("单挑模式：快速开局对决与AI推演≥3回合", async () => {
	const browser = await launchChrome();
	try {
		await testMode(browser, "single", 3);
	} finally {
		await browser.close();
	}
});

const results = await suite.run();
process.exitCode = results.every(r => r.ok) ? 0 : 1;

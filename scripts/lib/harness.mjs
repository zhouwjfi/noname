/**
 * 轻量测试框架：用例注册、断言、失败诊断与汇总报表
 */

import { inspect } from "node:util";

export class AssertionError extends Error {
	constructor(message) {
		super(message);
		this.name = "AssertionError";
	}
}

export function assert(condition, message) {
	if (!condition) throw new AssertionError(message ?? "断言失败");
}

export function assertEquals(actual, expected, message) {
	if (actual !== expected) {
		throw new AssertionError(`${message ?? "数值不符"}: 期望 ${inspect(expected)}，实际 ${inspect(actual)}`);
	}
}

export function assertAlmostEqual(actual, expected, tolerance, message) {
	if (typeof actual !== "number" || Math.abs(actual - expected) > tolerance) {
		throw new AssertionError(
			`${message ?? "数值近似断言失败"}: 期望 ${expected}±${tolerance}，实际 ${actual}`
		);
	}
}

export function assertIncludes(haystack, needle, message) {
	const found = String(haystack ?? "").includes(needle);
	if (!found) {
		throw new AssertionError(`${message ?? "内容断言失败"}: 未在输出中找到 "${needle}"\n实际内容: ${String(haystack).slice(0, 500)}`);
	}
}

/**
 * 轮询等待条件成立
 */
export async function waitFor(predicate, { timeout = 15000, interval = 250, label = "条件" } = {}) {
	const start = Date.now();
	let lastError;
	let lastValue;
	while (Date.now() - start < timeout) {
		try {
			lastValue = await predicate();
			if (lastValue) return lastValue;
		} catch (e) {
			lastError = e;
		}
		await sleep(interval);
	}
	const errDetail = lastError ? `，最后一次轮询异常: ${lastError.message}` : `，最后取值: ${inspect(lastValue).slice(0, 200)}`;
	throw new AssertionError(`等待超时(${timeout}ms): ${label}${errDetail}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Suite {
	/**
	 * @param {string} name 模块名
	 * @param {(ctx: {test: (name: string, fn: () => any) => void}) => any} register
	 */
	constructor(name) {
		this.name = name;
		this.tests = [];
	}
	test(name, fn) {
		this.tests.push({ name, fn });
	}
	async run() {
		console.log(`\n━━━ ${this.name} ━━━`);
		const results = [];
		for (const t of this.tests) {
			const start = Date.now();
			try {
				await t.fn();
				results.push({ name: t.name, ok: true, ms: Date.now() - start });
				console.log(`  ✅ PASS  ${t.name} (${Date.now() - start}ms)`);
			} catch (e) {
				results.push({ name: t.name, ok: false, error: e, ms: Date.now() - start });
				console.log(`  ❌ FAIL  ${t.name} (${Date.now() - start}ms)`);
				console.log(`         ${String(e.message).split("\n").slice(0, 6).join("\n         ")}`);
			}
		}
		return results;
	}
}

/** 汇总打印所有模块结果，返回是否全部通过 */
export function printSummary(allResults) {
	console.log("\n════════════════ 总报表 ════════════════");
	let pass = 0;
	let fail = 0;
	for (const [moduleName, results] of allResults) {
		const failed = results.filter(r => !r.ok);
		const passed = results.length - failed.length;
		pass += passed;
		fail += failed.length;
		const icon = failed.length === 0 ? "✅" : "❌";
		console.log(`${icon} ${moduleName}: ${passed}/${results.length} 通过`);
		for (const f of failed) {
			console.log(`   └─ ${f.name}: ${String(f.error.message).split("\n")[0].slice(0, 150)}`);
		}
	}
	console.log(`────────────────────────────────────────`);
	console.log(`合计: ${pass} 通过, ${fail} 失败, ${fail === 0 ? "🎉 全部 PASS" : "⚠️ 存在失败"}`);
	return fail === 0;
}

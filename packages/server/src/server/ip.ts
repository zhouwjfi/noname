import type { IncomingMessage } from "node:http";

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** 去掉 IPv4-mapped IPv6 前缀，统一成便于比较的形式 */
export function normalizeIp(ip: string): string {
	const value = ip.trim();
	const mapped = IPV4_MAPPED.exec(value);
	return mapped ? mapped[1] : value;
}

function parseIpv4(ip: string): number[] | null {
	const parts = ip.split(".");
	if (parts.length !== 4) {
		return null;
	}

	const bytes: number[] = [];
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) {
			return null;
		}

		const byte = Number(part);
		if (byte > 255) {
			return null;
		}

		bytes.push(byte);
	}

	return bytes;
}

function parseIpv6(ip: string): number[] | null {
	const value = ip.split("%")[0];
	const halves = value.split("::");
	if (halves.length > 2) {
		return null;
	}

	const parseGroups = (str: string): number[] | null => {
		const bytes: number[] = [];
		if (!str) {
			return bytes;
		}

		for (const group of str.split(":")) {
			if (!/^[0-9a-f]{1,4}$/i.test(group)) {
				return null;
			}

			const num = parseInt(group, 16);
			bytes.push(num >> 8, num & 0xff);
		}
		return bytes;
	};

	const head = parseGroups(halves[0]);
	const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
	if (!head || !tail) {
		return null;
	}

	if (halves.length === 2) {
		const missing = 16 - head.length - tail.length;
		if (missing < 1) {
			return null;
		}

		return [...head, ...new Array<number>(missing).fill(0), ...tail];
	}

	return head.length === 16 ? head : null;
}

function parseIp(ip: string): number[] | null {
	const value = normalizeIp(ip);
	if (!value) {
		return null;
	}

	return value.includes(":") ? parseIpv6(value) : parseIpv4(value);
}

function matchPrefix(ip: number[], network: number[], prefix: number): boolean {
	const wholeBytes = prefix >> 3;
	const restBits = prefix & 7;

	for (let i = 0; i < wholeBytes; i++) {
		if (ip[i] !== network[i]) {
			return false;
		}
	}

	if (restBits) {
		const mask = 0xff << (8 - restBits);
		if ((ip[wholeBytes] & mask) !== (network[wholeBytes] & mask)) {
			return false;
		}
	}

	return true;
}

/** 判断 ip 是否命中单条规则，规则可以是单个地址或 CIDR */
function matchRule(ip: string, rule: string): boolean {
	const parsedIp = parseIp(ip);
	if (!parsedIp) {
		return false;
	}

	const [address, rawPrefix] = rule.trim().split("/");
	const network = parseIp(address);
	if (!network || network.length !== parsedIp.length) {
		return false;
	}

	const maxPrefix = network.length * 8;
	const prefix = rawPrefix === undefined ? maxPrefix : Number(rawPrefix);
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
		return false;
	}

	return matchPrefix(parsedIp, network, prefix);
}

export function isTrustedIp(ip: string, trustedProxies: string[]): boolean {
	return trustedProxies.some(rule => matchRule(ip, rule));
}

/**
 * 解析客户端真实 IP。
 *
 * 只有当连接直连来源命中受信任代理列表时，才会读取 X-Forwarded-For；
 * 从右往左跳过受信任的代理，第一个不受信任的地址即为真实客户端。
 */
export function resolveClientIp(req: IncomingMessage, trustedProxies: string[]): string {
	const remote = normalizeIp(req.socket.remoteAddress ?? "");
	if (!trustedProxies.length || !isTrustedIp(remote, trustedProxies)) {
		return remote;
	}

	const forwarded = req.headers["x-forwarded-for"];
	const chain = (Array.isArray(forwarded) ? forwarded.join(",") : (forwarded ?? ""))
		.split(",")
		.map(entry => normalizeIp(entry))
		.filter(entry => entry.length > 0);

	for (let i = chain.length - 1; i >= 0; i--) {
		if (!isTrustedIp(chain[i], trustedProxies)) {
			return chain[i];
		}
	}

	if (chain.length) {
		return chain[0];
	}

	const realIp = req.headers["x-real-ip"];
	return (typeof realIp === "string" && normalizeIp(realIp)) || remote;
}

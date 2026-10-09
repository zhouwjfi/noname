#!/usr/bin/env node

import { createServer } from "./server/createServer";

function readPort(): number {
	const portArgIndex = process.argv.findIndex(arg => arg === "--port" || arg === "-p");
	const rawPort = portArgIndex === -1 ? process.env.PORT : process.argv[portArgIndex + 1];
	const port = Number(rawPort ?? 8082);

	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new Error(`Invalid port: ${rawPort}`);
	}

	return port;
}

function readTrustedProxies(): string[] {
	const argIndex = process.argv.findIndex(arg => arg === "--trust-proxy");
	const raw = argIndex === -1 ? process.env.TRUST_PROXY : process.argv[argIndex + 1];

	if (!raw) {
		return [];
	}

	return raw
		.split(",")
		.map(entry => entry.trim())
		.filter(entry => entry.length > 0);
}

function readMaxRooms(): number {
	const argIndex = process.argv.findIndex(arg => arg === "--max-rooms");
	const raw = argIndex === -1 ? process.env.MAX_ROOMS : process.argv[argIndex + 1];
	const maxRooms = Number(raw ?? 2);

	if (!Number.isInteger(maxRooms) || maxRooms < 0) {
		throw new Error(`Invalid maxRooms: ${raw}`);
	}

	return maxRooms;
}

const port = readPort();
const trustedProxies = readTrustedProxies();
const maxRooms = readMaxRooms();
const server = createServer({ port, trustedProxies, maxRooms });

const stop = async () => {
	await server.stop();
	process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function main() {
	await server.start();
	console.log(`Server listening on port ${port} (max rooms: ${maxRooms})`);
	if (trustedProxies.length) {
		console.log(`Trusted proxies: ${trustedProxies.join(", ")}`);
	}
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});

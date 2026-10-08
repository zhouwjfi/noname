export interface ServerOptions {
	port?: number;
	/**
	 * 受信任的反向代理地址，支持单个 IP 或 CIDR（如 `"172.17.0.0/16"`）。
	 *
	 * 仅当连接直连来源命中该列表时，才会读取 `X-Forwarded-For` / `X-Real-IP` 作为客户端 IP；
	 * 否则一律使用 socket 地址，避免客户端伪造请求头。
	 */
	trustedProxies?: string[];
}

export interface ServerInstance {
	start(): Promise<void>;
	stop(): Promise<void>;
}

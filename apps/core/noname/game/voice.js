import { _status, game, lib, ui, get } from "noname";

// --- 1. IMA-ADPCM 编解码算法表与辅助函数 ---
const STEP_TABLE = [
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
	19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
	50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
	130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
	337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
	876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
	2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
	5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
	15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
];

const INDEX_TABLE = [
	-1, -1, -1, -1, 2, 4, 6, 8,
	-1, -1, -1, -1, 2, 4, 6, 8
];

export const VOICE_ICONS = {
	mic: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>',
	micOff: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>',
	speaker: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
	speakerOff: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>'
};

function clamp(val, min, max) {
	return Math.max(min, Math.min(max, val));
}

/**
 * 将 16kHz Float32Array 压缩为 IMA-ADPCM Uint8Array
 */
function encodeAdpcm(floatSamples) {
	const len = floatSamples.length;
	const outLen = 4 + Math.ceil(len / 2);
	const out = new Uint8Array(outLen);

	let predicted = 0;
	let index = 0;

	if (len > 0) {
		predicted = clamp(Math.round(floatSamples[0] * 32767), -32768, 32767);
	}

	out[0] = predicted & 0xff;
	out[1] = (predicted >> 8) & 0xff;
	out[2] = index & 0xff;
	out[3] = 0;

	let outByteIdx = 4;

	function encodeSample(sample) {
		let step = STEP_TABLE[index];
		let diff = sample - predicted;
		let nibble = 0;
		if (diff < 0) {
			nibble = 8;
			diff = -diff;
		}
		let mask = 4;
		let tempStep = step;
		for (let b = 0; b < 3; b++) {
			if (diff >= tempStep) {
				nibble |= mask;
				diff -= tempStep;
			}
			tempStep >>= 1;
			mask >>= 1;
		}

		let delta = (step >> 3);
		if (nibble & 1) delta += (step >> 2);
		if (nibble & 2) delta += (step >> 1);
		if (nibble & 4) delta += step;
		if (nibble & 8) predicted -= delta;
		else predicted += delta;
		predicted = clamp(predicted, -32768, 32767);

		index = clamp(index + INDEX_TABLE[nibble], 0, 88);
		return nibble;
	}

	for (let i = 0; i < len; i += 2) {
		const s1 = clamp(Math.round(floatSamples[i] * 32767), -32768, 32767);
		const nibble1 = encodeSample(s1);

		let nibble2 = 0;
		if (i + 1 < len) {
			const s2 = clamp(Math.round(floatSamples[i + 1] * 32767), -32768, 32767);
			nibble2 = encodeSample(s2);
		}

		out[outByteIdx++] = (nibble1 & 0x0f) | ((nibble2 & 0x0f) << 4);
	}

	return out;
}

/**
 * 将 IMA-ADPCM Uint8Array 解压为 16kHz Float32Array
 */
function decodeAdpcm(u8) {
	if (!u8 || u8.length < 4) return new Float32Array(0);
	let predicted = (u8[0] | (u8[1] << 8));
	if (predicted >= 32768) predicted -= 65536;
	let index = clamp(u8[2], 0, 88);

	const bodyLen = u8.length - 4;
	const out = new Float32Array(bodyLen * 2);
	let outIdx = 0;

	function decodeNibble(nibble) {
		const step = STEP_TABLE[index];
		let delta = (step >> 3);
		if (nibble & 1) delta += (step >> 2);
		if (nibble & 2) delta += (step >> 1);
		if (nibble & 4) delta += step;
		if (nibble & 8) predicted -= delta;
		else predicted += delta;
		predicted = clamp(predicted, -32768, 32767);

		index = clamp(index + INDEX_TABLE[nibble], 0, 88);
		return predicted / 32768;
	}

	for (let i = 4; i < u8.length; i++) {
		const b = u8[i];
		out[outIdx++] = decodeNibble(b & 0x0f);
		out[outIdx++] = decodeNibble((b >> 4) & 0x0f);
	}
	return out;
}

function uint8ToBase64(u8) {
	let binary = "";
	const len = u8.byteLength;
	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(u8[i]);
	}
	return btoa(binary);
}

function base64ToUint8(base64) {
	const binary = atob(base64);
	const len = binary.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * 线性插值音频重采样（如 48kHz / 44.1kHz -> 16kHz）
 */
function downsample(buffer, fromRate, toRate = 16000) {
	if (fromRate === toRate) return buffer;
	const ratio = fromRate / toRate;
	const newLen = Math.round(buffer.length / ratio);
	const result = new Float32Array(newLen);
	for (let i = 0; i < newLen; i++) {
		const idx = i * ratio;
		const left = Math.floor(idx);
		const right = Math.min(left + 1, buffer.length - 1);
		const frac = idx - left;
		result[i] = buffer[left] * (1 - frac) + buffer[right] * frac;
	}
	return result;
}

// --- 2. VoiceManager 语音管理核心类（极简双按钮设计） ---
export class VoiceManager {
	enabled = false;
	muted = true; // 默认闭麦，保护用户隐私
	deafened = false; // 默认开启扬声器
	volume = 1.0;
	vadThreshold = 0.018; // 静音检测阈值
	isSpeakingLocal = false;

	audioContext = null;
	mediaStream = null;
	sourceNode = null;
	processor = null;
	gainNode = null;

	speakerPlayTimes = new Map();
	speakingTimers = new Map();
	silenceCount = 0;
	seq = 0;

	constructor() {
		this.injectStyles();
		const unlock = () => {
			if (this.audioContext && this.audioContext.state === "suspended") {
				this.audioContext.resume().catch(() => {});
			}
		};
		window.addEventListener("click", unlock, { passive: true });
		window.addEventListener("touchend", unlock, { passive: true });
		window.addEventListener("keydown", unlock, { passive: true });
	}

	injectStyles() {
		if (document.getElementById("noname-voice-style")) return;
		const style = document.createElement("style");
		style.id = "noname-voice-style";
		style.textContent = `
			/* 玩家发言头像发光动画 */
			.voice-speaking {
				box-shadow: 0 0 12px #22c55e, 0 0 24px rgba(34, 197, 94, 0.6) inset !important;
				animation: voice-pulse 0.8s infinite alternate !important;
				position: relative;
			}
			.voice-speaking::after {
				content: "🔊";
				position: absolute;
				bottom: 2px;
				right: 2px;
				font-size: 14px;
				line-height: 1;
				background: rgba(0, 0, 0, 0.6);
				border-radius: 50%;
				padding: 2px;
				z-index: 10;
			}
			@keyframes voice-pulse {
				from {
					filter: drop-shadow(0 0 4px #22c55e);
				}
				to {
					filter: drop-shadow(0 0 10px #4ade80);
				}
			}

			/* 右下角常驻语音控制坞样式 */
			#voice-dock {
				position: absolute !important;
				right: 14px !important;
				bottom: 14px !important;
				top: auto !important;
				left: auto !important;
				z-index: 8 !important;
				display: flex !important;
				flex-direction: row !important;
				align-items: center !important;
				gap: 8px !important;
				padding: 5px 8px !important;
				background: rgba(20, 24, 30, 0.72) !important;
				backdrop-filter: blur(10px) !important;
				-webkit-backdrop-filter: blur(10px) !important;
				border: 1px solid rgba(255, 255, 255, 0.22) !important;
				border-radius: 24px !important;
				box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45) !important;
				pointer-events: auto !important;
				touch-action: none !important;
				cursor: default !important;
				transition: bottom 0.3s ease, right 0.3s ease, transform 0.15s ease !important;
			}
			#voice-dock.dragging {
				transition: none !important;
			}
			/* 对局开始且为移动端布局时避让装备栏 */
			#arena:not(.nome) ~ #voice-dock,
			#window.phone #arena:not(.nome) ~ #voice-dock {
				bottom: 140px !important;
			}
			#voice-dock > .voice-dock-btn {
				position: relative !important;
				left: auto !important;
				top: auto !important;
				width: 36px !important;
				height: 36px !important;
				border-radius: 50% !important;
				background: rgba(255, 255, 255, 0.12) !important;
				border: 1px solid rgba(255, 255, 255, 0.22) !important;
				box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3) !important;
				cursor: pointer !important;
				user-select: none !important;
				-webkit-user-select: none !important;
				transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
				display: flex !important;
				align-items: center !important;
				justify-content: center !important;
				padding: 0 !important;
				margin: 0 !important;
				overflow: hidden !important;
				color: #fff !important;
			}
			#voice-dock > .voice-dock-btn svg {
				width: 20px !important;
				height: 20px !important;
				display: block !important;
				pointer-events: none !important;
				flex-shrink: 0 !important;
			}
			#voice-dock > .voice-dock-btn:active {
				transform: scale(0.92) !important;
				background: rgba(255, 255, 255, 0.25) !important;
			}
			#voice-dock > .voice-btn-mic.muted {
				opacity: 0.85 !important;
				filter: none !important;
				color: #ef4444 !important;
				background: rgba(239, 68, 68, 0.25) !important;
				border: 1px solid rgba(239, 68, 68, 0.45) !important;
			}
			#voice-dock > .voice-btn-mic.active {
				opacity: 1 !important;
				color: #4ade80 !important;
				background: rgba(34, 197, 94, 0.22) !important;
				border: 1px solid rgba(34, 197, 94, 0.5) !important;
			}
			#voice-dock > .voice-btn-mic.speaking {
				opacity: 1 !important;
				color: #22c55e !important;
				filter: drop-shadow(0 0 4px #22c55e) !important;
				transform: scale(1.1) !important;
				background: rgba(34, 197, 94, 0.38) !important;
				border: 1px solid #22c55e !important;
				animation: voice-pulse 0.8s infinite alternate !important;
			}
			#voice-dock > .voice-btn-speaker.muted {
				opacity: 0.85 !important;
				filter: none !important;
				color: #ef4444 !important;
				background: rgba(239, 68, 68, 0.25) !important;
				border: 1px solid rgba(239, 68, 68, 0.45) !important;
			}
			#voice-dock > .voice-btn-speaker.active {
				opacity: 1 !important;
				color: #e2e8f0 !important;
				background: rgba(255, 255, 255, 0.16) !important;
				border: 1px solid rgba(255, 255, 255, 0.35) !important;
			}
		`;
		document.head.appendChild(style);
	}

	getAudioContext() {
		if (!this.audioContext) {
			const AudioContextClass = window.AudioContext || window.webkitAudioContext;
			this.audioContext = new AudioContextClass();
			this.gainNode = this.audioContext.createGain();
			this.gainNode.gain.value = this.volume;
			this.gainNode.connect(this.audioContext.destination);
		}
		if (this.audioContext.state === "suspended") {
			this.audioContext.resume().catch(() => {});
		}
		return this.audioContext;
	}

	async initMicrophone() {
		if (this.mediaStream) return true;
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
					channelCount: 1,
				}
			});
			this.mediaStream = stream;
			this.setupAudioNodes();
			this.enabled = true;
			return true;
		} catch (err) {
			console.error("Microphone access failed:", err);
			alert("未能获取麦克风权限，请确认浏览器已允许使用麦克风。");
			return false;
		}
	}

	setupAudioNodes() {
		const ctx = this.getAudioContext();
		if (!this.mediaStream) return;

		this.sourceNode = ctx.createMediaStreamSource(this.mediaStream);
		this.processor = ctx.createScriptProcessor(2048, 1, 1);

		this.sourceNode.connect(this.processor);

		const silentGain = ctx.createGain();
		silentGain.gain.value = 0;
		this.processor.connect(silentGain);
		silentGain.connect(ctx.destination);

		this.processor.onaudioprocess = e => this.handleAudioInput(e);
	}

	handleAudioInput(e) {
		if (!this.enabled || this.muted) return;

		const input = e.inputBuffer.getChannelData(0);
		const samples16k = downsample(input, this.audioContext.sampleRate, 16000);

		// 计算 RMS 能量
		let sumSq = 0;
		for (let i = 0; i < samples16k.length; i++) {
			sumSq += samples16k[i] * samples16k[i];
		}
		const rms = Math.sqrt(sumSq / samples16k.length);

		let shouldSend = false;
		if (rms >= this.vadThreshold) {
			this.silenceCount = 0;
			shouldSend = true;
		} else if (this.silenceCount < 2) {
			this.silenceCount++;
			shouldSend = true;
		} else {
			shouldSend = false;
		}

		if (shouldSend) {
			this.setLocalSpeaking(true);
			const adpcm = encodeAdpcm(samples16k);
			const b64 = uint8ToBase64(adpcm);
			game.send("voice", { type: "audio", data: b64, seq: ++this.seq });
		} else if (this.isSpeakingLocal) {
			this.setLocalSpeaking(false);
			game.send("voice", { type: "state", speaking: false });
		}
	}

	onReceive(fromWsid, payload) {
		if (!payload || !fromWsid || typeof fromWsid !== "string") return;
		if (payload.type === "audio") {
			if (this.deafened) return;
			const ctx = this.getAudioContext();
			if (ctx.state === "suspended") {
				ctx.resume().catch(() => {});
			}

			const u8 = base64ToUint8(payload.data);
			const floatSamples = decodeAdpcm(u8);
			if (!floatSamples || floatSamples.length === 0) return;

			const buffer = ctx.createBuffer(1, floatSamples.length, 16000);
			buffer.copyToChannel(floatSamples, 0);

			const source = ctx.createBufferSource();
			source.buffer = buffer;
			source.connect(this.gainNode);

			const now = ctx.currentTime;
			let nextTime = this.speakerPlayTimes.get(fromWsid) || 0;
			if (nextTime < now || nextTime > now + 0.25) {
				nextTime = now + 0.04;
			}
			source.start(nextTime);
			nextTime += buffer.duration;
			this.speakerPlayTimes.set(fromWsid, nextTime);

			this.setRemoteSpeaking(fromWsid, true);
		} else if (payload.type === "state") {
			if (!payload.speaking || payload.left) {
				this.setRemoteSpeaking(fromWsid, false);
			}
		}
	}

	getMyWsid() {
		return game.wsid || game.onlineID || null;
	}

	getLocalPlayerNodes() {
		const nodes = [];

		// 1. 等待房间中的本地玩家
		if (game.connectPlayers && game.connectPlayers.length > 0) {
			let mySeat = null;

			// A. 如果 game.me 在 connectPlayers 中，直接以 game.me 为准（房主通常为 seat 0）
			if (game.me && game.connectPlayers.includes(game.me)) {
				mySeat = game.me;
			}

			// B. 尝试按在线 ID 匹配（客机连接后带有其 playerid / wsid）
			if (!mySeat && (game.onlineID || game.wsid)) {
				const myId = game.onlineID || game.wsid;
				for (const cp of game.connectPlayers) {
					if (cp && cp.playerid && cp.playerid === myId) {
						mySeat = cp;
						break;
					}
				}
			}

			// C. 如果依然未找到，但处于联机等待房间且当前为房主或首位玩家
			if (!mySeat && (!game.onlineID || game.connectPlayers[0] === game.me)) {
				mySeat = game.connectPlayers[0];
			}

			if (mySeat) {
				nodes.push(mySeat);
			}
		}

		// 2. 战斗游戏中的本地玩家（game.me 始终代表本机玩家）
		if (game.me && !nodes.includes(game.me)) {
			nodes.push(game.me);
		}

		return nodes;
	}

	getRemotePlayerNodes(wsid) {
		if (!wsid || typeof wsid !== "string") return [];
		const myId = this.getMyWsid();
		if (wsid === myId) return [];

		const nodes = [];
		const localNodes = this.getLocalPlayerNodes();

		// 1. 等待房间中的其他玩家
		if (game.connectPlayers) {
			for (const cp of game.connectPlayers) {
				if (cp && cp.playerid && cp.playerid === wsid && !localNodes.includes(cp)) {
					nodes.push(cp);
				}
			}
			// 备用兜底：如果是客机端，且发言者是房主（座位 0），但未精准匹配
			if (nodes.length === 0 && game.connectPlayers[0] && !localNodes.includes(game.connectPlayers[0])) {
				nodes.push(game.connectPlayers[0]);
			}
		}

		// 2. 游戏中通过 lib.playerOL 查找
		if (lib.playerOL && lib.playerOL[wsid]) {
			const p = lib.playerOL[wsid];
			if (p && !localNodes.includes(p) && !nodes.includes(p)) {
				nodes.push(p);
			}
		}

		// 3. 游戏中通过 game.players 查找
		if (game.players) {
			for (const p of game.players) {
				if (p && p.playerid && p.playerid === wsid && !localNodes.includes(p) && !nodes.includes(p)) {
					nodes.push(p);
				}
			}
		}

		return nodes;
	}

	setLocalSpeaking(bool) {
		this.isSpeakingLocal = bool;
		this.updateButtons();

		const targets = this.getLocalPlayerNodes();
		targets.forEach(node => {
			if (bool) {
				node.classList.add("voice-speaking");
			} else {
				node.classList.remove("voice-speaking");
			}
		});

		if (this.speakingTimers.has("__local__")) {
			clearTimeout(this.speakingTimers.get("__local__"));
		}
		if (bool) {
			const timer = setTimeout(() => {
				this.setLocalSpeaking(false);
				this.speakingTimers.delete("__local__");
			}, 400);
			this.speakingTimers.set("__local__", timer);
		}
	}

	setRemoteSpeaking(fromWsid, bool) {
		if (!fromWsid || typeof fromWsid !== "string") return;
		if (fromWsid === this.getMyWsid()) return;

		const targets = this.getRemotePlayerNodes(fromWsid);
		targets.forEach(node => {
			if (bool) {
				node.classList.add("voice-speaking");
			} else {
				node.classList.remove("voice-speaking");
			}
		});

		if (this.speakingTimers.has(fromWsid)) {
			clearTimeout(this.speakingTimers.get(fromWsid));
		}
		if (bool) {
			const timer = setTimeout(() => {
				this.setRemoteSpeaking(fromWsid, false);
				this.speakingTimers.delete(fromWsid);
			}, 400);
			this.speakingTimers.set(fromWsid, timer);
		}
	}

	setSpeaking(wsid, bool) {
		if (!wsid || wsid === "__local__" || wsid === this.getMyWsid()) {
			this.setLocalSpeaking(bool);
		} else {
			this.setRemoteSpeaking(wsid, bool);
		}
	}

	getPlayerNodes(wsid) {
		if (!wsid || wsid === "__local__" || wsid === this.getMyWsid()) {
			return this.getLocalPlayerNodes();
		}
		return this.getRemotePlayerNodes(wsid);
	}

	async toggleMute() {
		if (this.muted) {
			if (!this.mediaStream) {
				const ok = await this.initMicrophone();
				if (!ok) return;
			}
			this.muted = false;
		} else {
			this.muted = true;
			this.setLocalSpeaking(false);
			game.send("voice", { type: "state", speaking: false });
		}
		this.updateButtons();
	}

	toggleDeafen() {
		this.deafened = !this.deafened;
		if (this.gainNode) {
			this.gainNode.gain.value = this.deafened ? 0 : this.volume;
		}
		this.updateButtons();
	}

	updateButtons() {
		// 1. 麦克风按钮
		if (ui.micButton) {
			if (this.muted) {
				ui.micButton.innerHTML = VOICE_ICONS.micOff;
				ui.micButton.classList.remove("active", "speaking");
				ui.micButton.classList.add("muted");
				ui.micButton.title = "麦克风已关闭（点击开启说话）";
			} else if (this.isSpeakingLocal) {
				ui.micButton.innerHTML = VOICE_ICONS.mic;
				ui.micButton.classList.remove("muted");
				ui.micButton.classList.add("speaking");
				ui.micButton.title = "正在说话...";
			} else {
				ui.micButton.innerHTML = VOICE_ICONS.mic;
				ui.micButton.classList.remove("muted", "speaking");
				ui.micButton.classList.add("active");
				ui.micButton.title = "麦克风已开启（点击关闭）";
			}
		}

		// 2. 扬声器按钮
		if (ui.speakerButton) {
			if (this.deafened) {
				ui.speakerButton.innerHTML = VOICE_ICONS.speakerOff;
				ui.speakerButton.classList.remove("active");
				ui.speakerButton.classList.add("muted");
				ui.speakerButton.title = "声音已静音（点击开启声音）";
			} else {
				ui.speakerButton.innerHTML = VOICE_ICONS.speaker;
				ui.speakerButton.classList.remove("muted");
				ui.speakerButton.classList.add("active");
				ui.speakerButton.title = "声音正常（点击静音）";
			}
		}
	}

	onRoomLeave() {
		this.setLocalSpeaking(false);
		if (this.mediaStream) {
			this.mediaStream.getTracks().forEach(track => track.stop());
			this.mediaStream = null;
		}
		if (this.processor) {
			this.processor.disconnect();
			this.processor = null;
		}
		if (this.sourceNode) {
			this.sourceNode.disconnect();
			this.sourceNode = null;
		}
		if (this.audioContext) {
			this.audioContext.close().catch(() => {});
			this.audioContext = null;
		}
		this.enabled = false;
		this.muted = true;
		this.deafened = false;
		this.isSpeakingLocal = false;
		this.speakerPlayTimes.clear();
		this.speakingTimers.clear();
		this.updateButtons();
		if (ui.voiceDock) {
			// 通知拖拽逻辑解绑 window 级监听器，再移除 DOM（防止监听器泄漏累积）
			window.dispatchEvent(new CustomEvent("noname-voicedock-destroy"));
			ui.voiceDock.remove();
			delete ui.voiceDock;
			delete ui.micButton;
			delete ui.speakerButton;
		}
	}
}

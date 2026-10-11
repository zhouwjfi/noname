import { lib, game, get, _status } from "noname";
import { Click } from "./click/index.js";
import { Create } from "./create/index.js";

export class UI {
	updates = [];
	thrown = [];
	touchlines = [];
	todiscard = {};
	/**
	 * @type { HTMLStyleElement[] }
	 */
	playerPositions = [];
	create = new Create();
	click = new Click();
	selected = {
		/**
		 * @type { Button[] }
		 */
		buttons: [],
		/**
		 * @type { Card[] }
		 */
		cards: [],
		/**
		 * @type { Player[] }
		 */
		targets: [],
	};
	/**
	 * @type { Dialog[] }
	 */
	dialogs;
	/**
	 * @type { Dialog }
	 */
	dialog;
	/**
	 * @type { HTMLDivElement }
	 */
	system;
	/**
	 * @type { HTMLDivElement }
	 */
	arena;
	/**
	 * @type { Control[] }
	 */
	controls;
	/**
	 * @type { Control }
	 */
	control;
	/**
	 * @type { Control | undefined }
	 */
	confirm;
	/**
	 * @type { Control | undefined }
	 */
	skills;
	/**
	 * @type { Control | undefined }
	 */
	skills1;
	/**
	 * @type { Control | undefined }
	 */
	skills2;
	/**
	 * @type { Control | undefined }
	 */
	skills3;
	/**
	 * @type { HTMLDivElement }
	 */
	window;
	/**
	 * @type { HTMLDivElement }
	 */
	pause;
	/**
	 * @type { HTMLAudioElement }
	 */
	backgroundMusic;
	/**
	 * @type { HTMLDivElement }
	 */
	special;
	/**
	 * @type { HTMLDivElement }
	 */
	fakeme;
	/**
	 * @type { HTMLDivElement }
	 */
	chess;
	/**
	 * 手动在菜单栏中添加一个武将包的ui
	 * @type { ((packName: string) => void)[] }
	 */
	updateCharacterPackMenu = [];
	/**
	 * 手动在菜单栏中添加一个卡牌包的ui
	 * @type { ((packName: string) => void)[] }
	 */
	updateCardPackMenu = [];
	/**
	 * @type { HTMLDivElement } 挑战模式下正在操作的角色
	 */
	mebg;
	/**
	 * @type { Function | undefined }
	 */
	updateUpdate;
	/**
	 * @type {HTMLDivElement}
	 */
	commandnode;
	/**
	 * @type {() => void}
	 */
	updateVideoMenu;
	/**
	 * @type {HTMLDivElement}
	 */
	menuContainer;
	/**
	 * @type {HTMLDivElement}
	 */
	auto;
	/**
	 * @type {HTMLDivElement}
	 */
	wuxie;
	/**
	 * @type {HTMLDivElement}
	 */
	tempnowuxie;
	/**
	 * @type {HTMLDivElement[]}
	 */
	toastQueue = [];

	/**
	 * @type {HTMLDivElement}
	 */
	cardPile;
	/**
	 * @type {HTMLDivElement}
	 */
	discardPile;
	/**
	 * @type {HTMLDivElement}
	 */
	ordering;
	/**
	 * @type {HTMLDivElement}
	 */
	coin;
	/**
	 * @type {Record<string, HTMLLinkElement | HTMLStyleElement>}
	 */
	css;
	/**
	 * PC端悬浮的手牌
	 * @type {HTMLElement | null}
	 */
	_handcardHover = null;
	/**
	 * @type {(HTMLDivElement & {
	 * 	fillnode: HTMLDivElement;
	 * 	popnode: HTMLDivElement;
	 * 	position: number;
	 * 	set(text: string | number, percentage: number): void;
	 * }) | undefined}
	 */
	timer;
	/**
	 * 计算手牌展开偏移量
	 * - 触屏设备：点击选中时展开
	 * - PC端：仅鼠标悬浮时展开
	 * @param {HTMLElement[]} cards - 手牌数组
	 * @param {{cardWidth?: number, currentMargin?: number}} [options] - 配置选项
	 * @returns {{spreadIndex: number, spreadLeft: number, spreadRight: number}}
	 */
	getSpreadOffset(cards, options = {}) {
		const result = { spreadIndex: -1, spreadLeft: 0, spreadRight: 0 };
		if (!lib.config.spread_card) return result;

		const cardWidth = options.cardWidth || 112;
		const currentMargin = options.currentMargin || cardWidth;
		if (currentMargin >= cardWidth - 2) return result;

		const isTouchscreen = lib.config.touchscreen;
		for (let i = 0; i < cards.length; i++) {
			let shouldSpread = false;
			if (isTouchscreen) {
				shouldSpread = cards[i].classList?.contains("selected");
			} else {
				shouldSpread = cards[i] === ui._handcardHover;
			}
			if (shouldSpread) {
				if (result.spreadIndex !== -1) {
					result.spreadIndex = -1;
					break;
				}
				result.spreadIndex = i;
			}
		}

		if (result.spreadIndex !== -1) {
			const spreadOffset = Math.max(0, cardWidth - currentMargin);
			result.spreadLeft = Math.round(spreadOffset * 0.2);
			result.spreadRight = spreadOffset;
		}

		return result;
	}
	refresh(node) {
		void window.getComputedStyle(node, null).getPropertyValue("opacity");
	}
	clear() {
		game.addVideo("uiClear");
		var thrown = document.getElementsByClassName("thrown");
		var nodes = [];
		var i;
		for (i = 0; i < thrown.length; i++) {
			nodes.push(thrown[i]);
		}
		for (i = 0; i < nodes.length; i++) {
			if (!nodes[i].fixed) {
				nodes[i].delete();
			}
		}
	}
	updatec() {
		if (_status.noupdatec) {
			return;
		}
		var length = 0,
			minoffset = -Infinity;
		var controls = [];
		var widths = [];
		var leftwidths = [];
		var add = function (node, first) {
			var thiswidth = parseInt(node.style.width);
			if (thiswidth) {
				thiswidth += 8;
				length += thiswidth;
				if (first) {
					leftwidths.push(thiswidth);
				} else {
					widths.push(thiswidth);
				}
			} else {
				length += node.offsetWidth;
				if (first) {
					leftwidths.push(node.offsetWidth);
				} else {
					widths.push(node.offsetWidth);
				}
			}
			if (first) {
				controls.unshift(node);
			} else {
				controls.push(node);
			}
		};
		widths = leftwidths.concat(widths);
		var staylefts = [];
		for (var i = 0; i < ui.control.childNodes.length; i++) {
			if (ui.control.childNodes[i].classList.contains("removing")) {
				continue;
			}
			if (lib.config.wuxie_right && ui.control.childNodes[i].stayleft) {
				staylefts.push(ui.control.childNodes[i]);
			} else {
				add(ui.control.childNodes[i]);
			}
		}
		if (staylefts.length) {
			var fullwidth = 0;
			var fullright = game.layout == "long" || game.layout == "long2" || game.chess || (game.layout != "nova" && parseInt(ui.arena.dataset.number) <= 5);
			for (var i = 0; i < widths.length; i++) {
				fullwidth += widths[i] + 6;
				if (get.is.phoneLayout()) {
					fullwidth += 6;
				}
			}
			fullwidth /= 2;
			var currentLeft = 0;
			for (var stayleft of staylefts) {
				stayleft.currentLeft = currentLeft;
				fullwidth += stayleft.offsetWidth;
				currentLeft += stayleft.offsetWidth;
				if (get.is.phoneLayout()) {
					fullwidth += 18;
					currentLeft += 18;
				} else {
					fullwidth += 12;
					currentLeft += 12;
				}
			}
			if (fullright) {
				fullwidth += 124;
				if ((game.layout == "long2" || game.layout == "nova") && ui.arena.dataset.number == "8" && get.mode() != "boss") {
					fullwidth += game.me.getLeft();
				}
			} else {
				fullwidth += 154;
			}
			for (var stayleft of staylefts) {
				if (game.layout != "default") {
					var current_offset = stayleft._offset;
					if (fullright) {
						stayleft._offset = Math.ceil(-ui.arena.offsetWidth / 2) + 135;
						if ((game.layout == "long2" || game.layout == "nova") && ui.arena.dataset.number == "8" && get.mode() != "boss") {
							stayleft._offset += game.me.getLeft();
						}
					} else {
						stayleft._offset = Math.ceil(-ui.arena.offsetWidth / 2) + 165;
					}
					stayleft._offset += stayleft.currentLeft;

					if (current_offset != stayleft._offset) {
						stayleft.addTempClass("controlpressdownx", 500);
						stayleft.style.transform = "translateX(" + stayleft._offset + "px)";
					}
				} else {
					add(stayleft, true);
				}
			}
			if (staylefts.length && controls.length) {
				var last = staylefts[staylefts.length - 1];
				minoffset = last._offset + last.offsetWidth + (get.is.phoneLayout() ? 18 : 12);
			}
		}
		if (!controls.length) {
			return;
		}
		var offset = -length / 2;
		if (minoffset > offset) {
			offset = minoffset;
		}
		var control = controls.shift();
		if (control._offset != offset) {
			control.addTempClass("controlpressdownx", 500);
			control.style.transform = "translateX(" + offset + "px)";
			control._offset = offset;
		}
		while (controls.length) {
			var control = controls.shift();
			var width = widths.shift();
			offset += width + 6;
			if (get.is.phoneLayout()) {
				offset += 6;
			}
			if (control._offset != offset) {
				control.addTempClass("controlpressdownx", 500);
				control.style.transform = "translateX(" + offset + "px)";
				control._offset = offset;
			}
		}
	}
	updatex() {
		ui.update.apply(this, arguments);
		ui.updatehl();
		for (var i = 0; i < lib.onresize.length; i++) {
			lib.onresize[i]();
		}
		var cfg = game.documentZoom / game.deviceZoom;
		ui.updated();
		game.documentZoom = cfg * game.deviceZoom;
		ui.updatez();
		delete ui._updatexr;
	}
	updatexr() {
		if (ui.isMobileLayoutStable()) {
			// 尺寸被判定为瞬态遮挡而保持静止时，若偏离基准持续存在（系统栏永久变化），
			// 由持久化计时器在静置一段时间后接受为新基准
			ui.#viewportSettleCheck();
			return;
		}
		ui.#viewportSettleCancel();
		if (ui._updatexr) {
			clearTimeout(ui._updatexr);
		}
		ui._updatexr = setTimeout(ui.updatex, 500);
	}
	updatejm(player, nodes, start, inv) {
		if (typeof start != "number") {
			start = 0;
		}
		var str;
		if (get.is.mobileMe(player) || game.layout == "default" || player.classList.contains("linked")) {
			str = "translateX(";
			if (inv) {
				str += "-";
			}
		} else {
			str = "translateY(";
		}
		var num = 0;
		for (var i = 0; i < nodes.childElementCount; i++) {
			var node = nodes.childNodes[i];
			if (i < start) {
				node.style.transform = "";
			} else if (node.classList.contains("removing")) {
				start++;
			} else {
				ui.refresh(node);
				node.classList.remove("drawinghidden");
				node._transform = str + (i - start) * 28 + "px)";
				node.style.transform = node._transform;
			}
		}
	}
	updatem(player) {
		if (player) {
			var start = 0;
			if (!player.classList.contains("linked2") || !ui.arena.classList.contains("nolink")) {
				start = 1;
			}
			ui.updatejm(player, player.node.marks, start, get.is.mobileMe(player));
		} else {
			for (var i = 0; i < game.players.length; i++) {
				ui.updatem(game.players[i]);
			}
		}
	}
	updatej(player) {
		if (player) {
			ui.updatejm(player, player.node.judges);
		} else {
			for (var i = 0; i < game.players.length; i++) {
				ui.updatej(game.players[i]);
			}
		}
	}
	updatehl() {
		if (!game.me) {
			return;
		}
		if (!ui.handcards1Container || !ui.handcards2Container) {
			return;
		}
		if (!ui.handcards1Container.childNodes.length) {
			return;
		}
		var hs1 = [],
			hs2 = [];
		for (var i = 0; i < ui.handcards1Container.firstChild.childElementCount; i++) {
			if (!ui.handcards1Container.firstChild.childNodes[i].classList.contains("removing")) {
				hs1.push(ui.handcards1Container.firstChild.childNodes[i]);
			}
		}
		for (var i = 0; i < ui.handcards2Container.firstChild.childElementCount; i++) {
			if (!ui.handcards2Container.firstChild.childNodes[i].classList.contains("removing")) {
				hs2.push(ui.handcards2Container.firstChild.childNodes[i]);
			}
		}
		var offset1,
			offset12 = 0;
		if (!lib.config.fold_card) {
			offset1 = 112;
			ui.handcards1Container.classList.add("scrollh");
		} else {
			offset1 = Math.min(112, (ui.handcards1Container.offsetWidth - 128) / (hs1.length - 1));
			if (hs1.length > 1 && offset1 < 32) {
				offset1 = 32;
				ui.handcards1Container.classList.add("scrollh");
			} else {
				ui.handcards1Container.classList.remove("scrollh");
			}
		}
		if (offset1 < 100) {
			offset12 = 100 - offset1;
		}
		var spread1 = ui.getSpreadOffset(hs1, { currentMargin: offset1 });
		for (var i = 0; i < hs1.length; i++) {
			var x1 = i * offset1;
			if (spread1.spreadLeft || spread1.spreadRight) {
				if (i < spread1.spreadIndex) x1 -= spread1.spreadLeft;
				else if (i > spread1.spreadIndex) x1 += spread1.spreadRight;
			}
			var baseTransform1 = "translateX(" + x1 + "px)";
			hs1[i]._transform = baseTransform1;
			hs1[i].style.transform = hs1[i].classList.contains("selected") ? baseTransform1 + " translateY(-20px)" : baseTransform1;
			ui.refresh(hs1[i]);
			hs1[i].classList.remove("drawinghidden");
			if (offset12 > 40) {
				offset12 = 90 - hs1[i].node.info.offsetWidth;
				hs1[i].node.info.querySelector("span").style.display = "none";
				if (hs1[i].node.name.classList.contains("long")) {
					hs1[i].node.name.style.transform = "translateY(16px)  scale(0.85)";
					hs1[i].node.name.style.transformOrigin = "top left";
				} else {
					hs1[i].node.name.style.transform = "translateY(16px)";
				}
				hs1[i].node.info.style.transform = "translateX(-" + offset12 + "px) translateY(-3px)";
			} else {
				hs1[i].node.info.querySelector("span").style.display = "";
				hs1[i].node.name.style.transform = "";
				hs1[i].node.name.style.transformOrigin = "";
				hs1[i].node.info.style.transform = "translateX(-" + offset12 + "px)";
			}
		}
		ui.handcards1Container.firstChild.style.width = offset1 * (hs1.length - 1) + 118 + (spread1.spreadLeft + spread1.spreadRight) + "px";

		var offset2,
			offset22 = 0;
		if (!lib.config.fold_card) {
			offset2 = 112;
			ui.handcards2Container.classList.add("scrollh");
		} else {
			offset2 = Math.min(112, (ui.handcards2Container.offsetWidth - 128) / (hs2.length - 1));
			if (hs2.length > 1 && offset2 < 32) {
				offset2 = 32;
				ui.handcards2Container.classList.add("scrollh");
			} else {
				ui.handcards2Container.classList.remove("scrollh");
			}
		}
		if (offset2 < 100) {
			offset22 = 100 - offset2;
		}
		var spread2 = ui.getSpreadOffset(hs2, { currentMargin: offset2 });
		for (var i = 0; i < hs2.length; i++) {
			var x2 = i * offset2;
			if (spread2.spreadLeft || spread2.spreadRight) {
				if (i < spread2.spreadIndex) x2 -= spread2.spreadLeft;
				else if (i > spread2.spreadIndex) x2 += spread2.spreadRight;
			}
			var baseTransform2 = "translateX(" + x2 + "px)";
			hs2[i]._transform = baseTransform2;
			hs2[i].style.transform = hs2[i].classList.contains("selected") ? baseTransform2 + " translateY(-20px)" : baseTransform2;
			ui.refresh(hs2[i]);
			hs2[i].classList.remove("drawinghidden");
			if (offset22 > 40) {
				offset22 = 90 - hs2[i].node.info.offsetWidth;
				hs2[i].node.info.querySelector("span").style.display = "none";
				if (hs2[i].node.name.classList.contains("long")) {
					hs2[i].node.name.style.transform = "translateY(16px)  scale(0.85)";
					hs2[i].node.name.style.transformOrigin = "top left";
				} else {
					hs2[i].node.name.style.transform = "translateY(16px)";
				}
				hs2[i].node.info.style.transform = "translateX(-" + offset22 + "px) translateY(-3px)";
			} else {
				hs2[i].node.info.querySelector("span").style.display = "";
				hs2[i].node.name.style.transform = "";
				hs2[i].node.name.style.transformOrigin = "";
				hs2[i].node.info.style.transform = "translateX(-" + offset22 + "px)";
			}
		}
		ui.handcards2Container.firstChild.style.width = offset2 * (hs2.length - 1) + 118 + (spread2.spreadLeft + spread2.spreadRight) + "px";
	}
	updateh(compute) {
		if (!game.me) {
			return;
		}
		if (!ui.handcards1Container) {
			return;
		}
		if (lib.config.low_performance) {
			if (compute) {
				ui.updatehl();
				setTimeout(ui.updatehl, 1000);
			}
			return;
		}
		if (compute) {
			ui.handcards1Container._handcardsWidth = ui.handcards1Container.offsetWidth;
			ui.handcards2Container._handcardsWidth = ui.handcards2Container.offsetWidth;
		}
		ui.updatehx(game.me.node.handcards1);
		ui.updatehx(game.me.node.handcards2);
	}
	updatehx(node) {
		var width = node.parentNode._handcardsWidth;
		var num = node.childElementCount - node.getElementsByClassName("removing").length;
		node.classList.remove("fold0");
		node.classList.remove("fold1");
		node.classList.remove("fold2");
		node.classList.remove("fold3");
		if (num * 78 + 40 >= width) {
			// node.dataset.fold=3;
			node.classList.add("fold3");
		} else if (num * 93 + 25 >= width) {
			// node.dataset.fold=2;
			node.classList.add("fold2");
		} else if (num * 112 + 6 >= width) {
			// node.dataset.fold=1;
			node.classList.add("fold1");
		} else {
			// node.dataset.fold=0;
			node.classList.add("fold0");
		}
	}
	/**
	 * 是否处于移动端环境（原生壳、手机/平板浏览器）
	 */
	isMobileDevice() {
		return !!(
			lib.device ||
			(typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) ||
			(typeof window !== "undefined" && ("ontouchstart" in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0)) && Math.min(window.screen.width, window.screen.height) <= 1024)
		);
	}
	#currentViewportSize() {
		return {
			width: document.documentElement.offsetWidth || window.innerWidth || 800,
			height: document.documentElement.offsetHeight || window.innerHeight || 600
		};
	}
	/**
	 * —— 移动端视口稳定器 ——
	 *
	 * 通知栏/控制中心/状态栏/URL 栏/软键盘等系统级临时遮挡（无论拉出还是收起）
	 * 一律视为瞬态事件并静默忽略，根容器（body）始终锁定在基准像素尺寸上，
	 * 保证画面 100% 绝对静止、零重排；仅以下真实尺寸变化允许重新布局：
	 * 1. 物理屏幕旋转（横竖屏切换）；
	 * 2. 宽度显著变化（分屏拖动、折叠屏展开，阈值 40px）；
	 * 3. 全屏等显示模式切换（用户主动意图，由 fullscreenchange 置位 `_viewportModeChanged`）；
	 * 4. 高度大幅增加（超过基准高度 30%，如桌面端窗口最大化/还原）；
	 * 5. 适度幅度（≤100px 且 ≤15%）的尺寸变化持续 5 秒仍不回归基准
	 *    （系统栏永久出现/消失，如 PWA 全屏显示模式被系统降级后未还原）。
	 *
	 * 桌面端不启用稳定器，窗口尺寸变化始终实时重排。
	 */
	getStableSize() {
		const { width: curW, height: curH } = this.#currentViewportSize();
		if (!this.isMobileDevice()) {
			this._stableSizes = null;
			this._lastOrientation = null;
			return { width: curW, height: curH };
		}
		const key = curW >= curH ? "landscape" : "portrait";
		const stableSizes = (this._stableSizes ??= {
			landscape: { width: 0, height: 0 },
			portrait: { width: 0, height: 0 }
		});
		const stable = stableSizes[key];

		if (this._lastOrientation !== key || !stable.width || !stable.height) {
			// 物理屏幕旋转或首次初始化：接受新尺寸
			this._lastOrientation = key;
			stable.width = curW;
			stable.height = curH;
		} else if (Math.abs(curW - stable.width) > 40) {
			// 宽度显著变化（分屏/折叠屏形态变化）：接受新尺寸
			stable.width = curW;
			stable.height = curH;
		} else if (window._nonameFullscreenRestorePending) {
			// 全屏恢复挂起中（通知栏等系统性退出全屏）：锁定基准尺寸等待手势恢复
		} else if (this._viewportModeChanged && (curW != stable.width || curH != stable.height)) {
			// 全屏等显示模式切换导致的尺寸变化：接受新尺寸
			stable.width = curW;
			stable.height = curH;
		} else if (this._viewportSettleAccept && (curW != stable.width || curH != stable.height)) {
			// 持续性适度尺寸变化（计时器判定为永久性系统栏变化）：接受新尺寸
			stable.width = curW;
			stable.height = curH;
		} else if (curH > stable.height * 1.3) {
			// 高度大幅增加：接受新尺寸
			stable.width = curW;
			stable.height = curH;
		}
		this._viewportModeChanged = false;
		this._viewportSettleAccept = false;
		// 其余情况（高度因系统临时遮挡小幅增减）：维持基准尺寸，画面保持静止
		return { width: stable.width, height: stable.height };
	}
	/**
	 * 当前视口变化是否属于"系统临时遮挡"（通知栏/软键盘等），应当静默忽略。
	 * 返回 true 表示画面保持静止、跳过重排；false 表示需要重新布局。
	 */
	isMobileLayoutStable() {
		if (!this.isMobileDevice()) {
			return false;
		}
		const { width: curW, height: curH } = this.#currentViewportSize();
		const key = curW >= curH ? "landscape" : "portrait";
		const stableSizes = (this._stableSizes ??= {
			landscape: { width: 0, height: 0 },
			portrait: { width: 0, height: 0 }
		});
		const stable = stableSizes[key];

		// 物理屏幕旋转或尚未建立基准：需要重排
		if (this._lastOrientation !== key || !stable.width || !stable.height) {
			return false;
		}
		// 宽度显著变化（分屏/折叠屏）：需要重排
		if (Math.abs(curW - stable.width) > 40) {
			return false;
		}
		// 全屏恢复挂起中：画面保持静止，等待下一次手势恢复全屏
		if (window._nonameFullscreenRestorePending) {
			return true;
		}
		// 全屏等显示模式切换（用户主动意图）：需要重排
		if (this._viewportModeChanged) {
			return false;
		}
		// 高度大幅增加：需要重排
		if (curH > stable.height * 1.3) {
			return false;
		}
		// 方向与宽度未变、高度仅因通知栏/状态栏/软键盘等临时遮挡小幅增减：画面保持静止
		return true;
	}
	/**
	 * 持久化判定：视口以适度幅度偏离基准并持续 ViewportSettleDelay 后，
	 * 视为永久性系统栏变化（如 PWA 全屏显示模式被系统降级且未还原），接受为新基准。
	 * 软键盘等大幅遮挡（>100px 或 >15%）永不自动接受。
	 */
	#viewportSettleCheck() {
		if (window._nonameFullscreenRestorePending || this._viewportSettleTimer) {
			return;
		}
		const { width: curW, height: curH } = this.#currentViewportSize();
		const key = curW >= curH ? "landscape" : "portrait";
		const stable = this._stableSizes?.[key];
		if (!stable || !stable.width) {
			return;
		}
		if (curW === stable.width && curH === stable.height) {
			this.#viewportSettleCancel();
			return;
		}
		if (Math.abs(curW - stable.width) > 40) {
			return;
		}
		if (Math.abs(curH - stable.height) > Math.max(100, stable.height * 0.15)) {
			return;
		}
		this._viewportSettleTimer = setTimeout(
			function () {
				this._viewportSettleTimer = null;
				// 计时到期时复核：尺寸仍偏离基准才接受，避免收起后误重排
				const size = this.#currentViewportSize();
				if (size.width !== stable.width || size.height !== stable.height) {
					this._viewportSettleAccept = true;
					ui.updatex();
				}
			}.bind(this),
			5000
		);
	}
	#viewportSettleCancel() {
		if (this._viewportSettleTimer) {
			clearTimeout(this._viewportSettleTimer);
			this._viewportSettleTimer = null;
		}
	}
	updated() {
		const size = ui.getStableSize();
		if (size.width < 900 || size.height < 500) {
			game.deviceZoom = Math.min(Math.round(size.width / 98) / 10, Math.round(size.height / 50) / 10);
		} else {
			game.deviceZoom = 1;
		}
	}
	updatez() {
		const size = ui.getStableSize();
		var width = size.width;
		var height = size.height;
		var zoom = game.documentZoom;
		if (zoom != 1) {
			document.body.style.width = Math.round(width / zoom) + "px";
			document.body.style.height = Math.round(height / zoom) + "px";
			document.body.style.transform = "scale(" + Math.floor(zoom * 100) / 100 + ")";
		} else {
			document.body.style.width = width + "px";
			document.body.style.height = height + "px";
			document.body.style.transform = "";
		}
	}
	update() {
		for (var i = 0; i < ui.updates.length; i++) {
			ui.updates[i]();
		}
		if (ui.dialog && !ui.dialog.classList.contains("noupdate")) {
			if (game.chess) {
				if (ui.dialog.content.scrollHeight < 240 && (!ui.dialog.buttons || !ui.dialog.buttons.length) && !ui.dialog.forcebutton) {
					ui.dialog.style.height = ui.dialog.content.offsetHeight + "px";
					ui.dialog.classList.add("slim");
				} else {
					ui.dialog.style.height = "";
					ui.dialog.classList.remove("slim");
				}
			} else {
				if ((!ui.dialog.buttons || !ui.dialog.buttons.length) && !ui.dialog.forcebutton && ui.dialog.classList.contains("fullheight") == false && get.mode() != "stone") {
					if (!ui.dialog.classList.contains("addNewRow")) {
						ui.dialog.classList.add("nobutton");
					}
					if (ui.dialog.content.offsetHeight < 240) {
						if (!ui.dialog._heightset) {
							ui.dialog._heightset = ui.dialog.style.height || true;
						}
						ui.dialog.style.height = ui.dialog.content.offsetHeight + "px";
						if (lib.config.show_log != "off") {
							ui.dialog.classList.add("scroll1");
							ui.dialog.classList.add("scroll2");
							return;
						}
					} else {
						if (typeof ui.dialog._heightset == "string") {
							ui.dialog.style.height = ui.dialog._heightset;
						} else if (ui.dialog._heightset) {
							ui.dialog.style.height = "";
						}
						delete ui.dialog._heightset;
					}
				} else {
					if (typeof ui.dialog._heightset == "string") {
						ui.dialog.style.height = ui.dialog._heightset;
					} else if (ui.dialog._heightset) {
						ui.dialog.style.height = "";
					}
					delete ui.dialog._heightset;
					if (!ui.dialog.classList.contains("addNewRow")) {
						ui.dialog.classList.remove("nobutton");
					}
				}
			}
			var height1 = ui.dialog.content.offsetHeight;
			var height2 = ui.dialog.contentContainer.offsetHeight;
			if (game.chess) {
				if (height1 < 240) {
					ui.dialog.style.height = height1 + "px";
				}
			} else {
				if (!ui.dialog.forcebutton && !ui.dialog._scrollset && (height1 <= 190 || (height2 >= height1 && height2 >= 210))) {
					ui.dialog.classList.remove("scroll1");
					ui.dialog.classList.remove("scroll2");
				} else {
					ui.dialog.classList.add("scroll1");
					ui.dialog.classList.add("scroll2");
					if (game.layout != "default") {
						ui.dialog.style.height = Math.min(height1, (game.layout == "long2" || game.layout == "nova") && ui.arena.classList.contains("choose-character") ? 380 : 350) + "px";
						ui.dialog._scrollset = true;
					}
				}
				if (game.layout == "long2" || game.layout == "nova") {
					if (height1 + 240 >= ui.arena.offsetHeight) {
						ui.dialog.classList.add("scroll3");
					} else {
						ui.dialog.classList.remove("scroll3");
					}
				}
			}
		}
	}
	recycle(node, key) {
		if (!ui._recycle) {
			ui._recycle = {};
		}
		if (typeof node == "string") {
			return ui._recycle[node];
		}
		ui._recycle[key] = node;
	}
	/**
	 * @author curpond
	 * @author Tipx-L
	 * @param {number} [numberOfPlayers]
	 */
	updateConnectPlayerPositions(numberOfPlayers) {
		if (typeof numberOfPlayers != "number") {
			const configOL = lib.configOL;
			numberOfPlayers = parseInt(configOL.player_number) || configOL.number;
		}
		if (!numberOfPlayers) {
			return;
		}
		const playerPositions = ui.playerPositions;
		playerPositions.forEach(position => {
			game.dynamicStyle.remove(position);
		});
		playerPositions.length = 0;
		const temporaryPlayer = ui.create.div(".player.connect", ui.window).hide();
		const computedStyle = getComputedStyle(temporaryPlayer);
		const halfWidth = parseFloat(computedStyle.width) / 2;
		const halfHeight = parseFloat(computedStyle.height) / 2;
		temporaryPlayer.remove();
		const halfNumberOfPlayers = Math.round(numberOfPlayers / 2);
		const upperPercentage = 100 / (halfNumberOfPlayers + 1);
		const scale = 10 / numberOfPlayers;
		for (let ordinal = 0; ordinal < halfNumberOfPlayers; ordinal++) {
			const selector = `#window>.player.connect[data-position='${ordinal}']`;
			const css = {
				left: `calc(${upperPercentage * (ordinal + 1)}% - ${halfWidth}px)`,
				top: `calc(${100 / 3}% - ${halfHeight}px)`,
			};
			if (scale < 1) {
				css["transform"] = `scale(${scale})`;
			}

			game.dynamicStyle.add(selector, css);
			playerPositions.push(selector);
		}
		const lowerPercentage = 100 / (numberOfPlayers - halfNumberOfPlayers + 1);
		for (let ordinal = halfNumberOfPlayers; ordinal < numberOfPlayers; ordinal++) {
			const selector = `#window>.player.connect[data-position='${ordinal}']`;
			const css = {
				left: `calc(${lowerPercentage * (ordinal - halfNumberOfPlayers + 1)}% - ${halfWidth}px)`,
				top: `calc(${(100 * 2) / 3}% - ${halfHeight}px)`,
			};
			if (scale < 1) {
				css["transform"] = `scale(${scale})`;
			}

			game.dynamicStyle.add(selector, css);
			playerPositions.push(selector);
		}
	}
	/**
	 * @author curpond
	 * @author Tipx-L
	 * @param {number} [numberOfPlayers]
	 */
	updatePlayerPositions(numberOfPlayers) {
		if (typeof numberOfPlayers != "number") {
			numberOfPlayers = ui.arena.dataset.number;
		}
		//当人数不超过8人时，还是用以前的布局
		if (!numberOfPlayers || numberOfPlayers <= 8) {
			return;
		}
		const playerPositions = ui.playerPositions;
		playerPositions.forEach(position => {
			game.dynamicStyle.remove(position);
		});
		playerPositions.length = 0;
		//单个人物的宽度，这里要设置玩家的实际的宽度
		const temporaryPlayer = ui.create.div(".player", ui.arena).hide();
		const computedStyle = getComputedStyle(temporaryPlayer);
		const scale = 6 / numberOfPlayers;
		//玩家顶部距离父容器上边缘的距离偏移的单位距离
		const quarterHeight = (parseFloat(computedStyle.height) / 4) * scale;
		const halfWidth = parseFloat(computedStyle.width) / 2;
		temporaryPlayer.remove();
		//列数，即假如8人场，除去自己后，上面7个人占7列
		const columnCount = numberOfPlayers - 1;
		const percentage = 90 / (columnCount - 1);
		//仅当游戏人数大于8人，且玩家的座位号大于0时，设置玩家的位置；因为0号位是game.me在最下方，无需设置
		for (let ordinal = 1; ordinal < numberOfPlayers; ordinal++) {
			const reversedOrdinal = columnCount - ordinal;
			//动态计算玩家的top属性，实现拱桥的效果；只让两边的各两个人向下偏移一些
			const top = Math.max(0, Math.round(numberOfPlayers / 5) - Math.min(Math.abs(ordinal - 1), Math.abs(reversedOrdinal))) * quarterHeight;
			const selector = `#arena[data-number='${numberOfPlayers}']>.player[data-position='${ordinal}']`;
			game.dynamicStyle.add(selector, {
				left: `calc(${percentage * reversedOrdinal + 5}% - ${halfWidth}px)`,
				top: `${top}px`,
				transform: `scale(${scale})`,
			});
			playerPositions.push(selector);
		}
	}
	updateRoundNumber(roundNumber, cardPileNumber) {
		if (ui.cardPileNumber) {
			ui.cardPileNumber.innerHTML = `${roundNumber}轮 剩余牌: ${cardPileNumber}`;
		}
	}
	updateEmptyRooms() {
		if (!ui.window) return;
		if (!ui.emptyRoomsNode) {
			ui.emptyRoomsNode = ui.create.div(".empty-rooms-tip", ui.window);
			ui.emptyRoomsNode.style.position = "absolute";
			ui.emptyRoomsNode.style.top = "45%";
			ui.emptyRoomsNode.style.left = "50%";
			ui.emptyRoomsNode.style.transform = "translate(-50%, -50%)";
			ui.emptyRoomsNode.style.width = "auto";
			ui.emptyRoomsNode.style.height = "auto";
			ui.emptyRoomsNode.style.whiteSpace = "nowrap";
			ui.emptyRoomsNode.style.textAlign = "center";
			ui.emptyRoomsNode.style.color = "rgba(255, 255, 255, 0.9)";
			ui.emptyRoomsNode.style.textShadow = "0 2px 6px rgba(0, 0, 0, 0.9)";
			ui.emptyRoomsNode.style.fontFamily = "STKaiti, KaiTi, 楷体, sans-serif";
			ui.emptyRoomsNode.style.cursor = "pointer";
			ui.emptyRoomsNode.style.pointerEvents = "auto";
			ui.emptyRoomsNode.style.zIndex = "10";
			ui.emptyRoomsNode.onclick = () => {
				if (ui.createRoomButton) {
					ui.createRoomButton.click?.() || (ui.createRoomButton.onclick && ui.createRoomButton.onclick());
				} else if (ui.click?.connectMenu) {
					ui.click.connectMenu();
				}
			};
			ui.emptyRoomsNode.innerHTML =
				'<div style="position:relative !important;display:block !important;font-size:22px;margin-bottom:12px;font-weight:bold;letter-spacing:3px;">暂无进行中的房间</div>' +
				'<div style="position:relative !important;display:inline-block !important;font-size:14px;color:rgba(255,255,255,0.7);padding:8px 20px;background:rgba(0,0,0,0.35);border-radius:18px;border:1px solid rgba(255,255,255,0.2);">点击此处或右下角【创建房间】开启对决</div>';
		}
		if (ui.rooms && ui.rooms.length > 0) {
			ui.emptyRoomsNode.style.display = "none";
		} else {
			ui.emptyRoomsNode.style.display = "block";
		}
	}
}

export let ui = new UI();

/**
 * @param { InstanceType<typeof UI> } [instance]
 */
export let setUI = instance => {
	ui = instance || new UI();
	if (lib.config.dev) {
		window.ui = ui;
	}
};

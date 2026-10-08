import { lib, game, ui, get, ai, _status } from "noname";
export const type = "mode";
/**
 * @type { () => importModeConfig }
 */
export default () => {
	return {
		name: "connect",
		start() {
			get.assignRandomPlayerIdentity();
			var directstartmode = lib.config.directstartmode;
			var serverUrl = lib.hallURL || "wss://tkser.zhouwj.tech:5443";
			ui.create.menu(true);
			event.textnode = ui.create.div("", "联机服务器");
			var createNode = function () {
				if (event.created) {
					return;
				}
				if (directstartmode && lib.node) {
					ui.exitroom = ui.create.system(
						"退出房间",
						function () {
							game.saveConfig("directstartmode");
							game.reload();
						},
						true
					);
					game.switchMode(directstartmode);
					return;
				}
				if (lib.node && window.require) {
					ui.startServer = ui.create.system(
						"启动服务器",
						function (e) {
							ui.click.shortcut(false);
							e.stopPropagation();
							ui.click.connectMenu();
						},
						true
					);
				}

				event.created = true;
				var serverUrl = lib.hallURL || "wss://tkser.zhouwj.tech:5443";
				var node = ui.create.div(".shadowed");
				node.style.width = "400px";
				node.style.height = "30px";
				node.style.lineHeight = "30px";
				node.style.fontFamily = "xinwei";
				node.style.fontSize = "20px";
				node.style.padding = "10px";
				node.style.left = "calc(50% - 210px)";
				node.style.top = "calc(50% - 20px)";
				node.style.whiteSpace = "nowrap";
				node.textContent = serverUrl;
				node.contentEditable = false;
				node.style.userSelect = "none";
				node.style.webkitUserSelect = "none";
				node.style.cursor = "default";
				node.style.textAlign = "center";
				node.style.overflow = "hidden";

				var connect = function (e) {
					event.textnode.textContent = "正在连接...";
					clearTimeout(event.timeout);
					if (e) {
						e.preventDefault();
					}
					game.requireSandboxOn(serverUrl);
					game.saveConfig("last_ip", serverUrl);
					game.connect(serverUrl, function (success) {
						if (success) {
							var info = lib.config.reconnect_info;
							if (info && info[0] == _status.ip) {
								game.onlineID = info[1];
								if (typeof (game.roomId = info[2]) == "string") {
									game.roomIdServer = true;
								}
							}
							return;
						}
						if (event.textnode) {
							alert("连接失败");
							event.textnode.textContent = "联机服务器";
						}
					});
				};
				ui.window.appendChild(node);
				ui.ipnode = node;

				var text = event.textnode;
				text.style.width = "400px";
				text.style.height = "30px";
				text.style.lineHeight = "30px";
				text.style.fontFamily = "xinwei";
				text.style.fontSize = "30px";
				text.style.padding = "10px";
				text.style.left = "calc(50% - 200px)";
				text.style.top = "calc(50% - 80px)";
				text.style.textAlign = "center";
				ui.window.appendChild(text);
				ui.iptext = text;

				var button = ui.create.div(".menubutton.highlight.large.pointerdiv", "连接", connect);
				button.style.width = "70px";
				button.style.left = "calc(50% - 35px)";
				button.style.top = "calc(50% + 60px)";
				ui.window.appendChild(button);
				ui.ipbutton = button;

				connect();

				lib.init.onfree();
			};
			createNode();
			if (!game.onlineKey) {
				game.onlineKey = localStorage.getItem(lib.configprefix + "key");
				if (!game.onlineKey) {
					game.onlineKey = get.id();
					localStorage.setItem(lib.configprefix + "key", game.onlineKey);
				}
			}
			_status.connectDenied = createNode;
			setTimeout(lib.init.onfree, 1000);
		},
	};
};

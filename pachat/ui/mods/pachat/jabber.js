var jabber;

console.log("load modified jabber.js"); // modifications are marked with PA CHAT
///////////////// PA CHAT
var CONFERENCE_URL = "conference.xmpp.uberent.com";
/////////////// PA CHAT

var allowLogging = true; /* squelch logging by default */
function log(object) {
	if (allowLogging)
		console.log(object);
}

function Jabberer(uber_id, jabber_token, use_ubernetdev) {
	var self = this;
	var connection;
	
	var MAX_RETRIES = 3;
	var connection_attempts = 0;

	self.useUbernetdev = ko.observable().extend({
		session : 'use_ubernetdev'
	});
	if (use_ubernetdev)
		self.useUbernetdev(!!use_ubernetdev);
	
	var SERVICE_URL = self.useUbernetdev() ? 'xmpp.uberentdev.com'
			: 'xmpp.uberent.com';

	self.uberId = ko.observable().extend({
		session : 'uberId'
	});
	if (uber_id)
		self.uberId(uber_id);

	self.jabberToken = ko.observable().extend({
		session : 'jabberToken'
	});
	if (jabber_token)
		self.jabberToken(jabber_token);

	self.jid = ko.observable('').extend({
		session : 'jabberJid'
	});
	self.sid = ko.observable('').extend({
		session : 'jabberSid'
	});
	self.rid = ko.observable('').extend({
		session : 'jabberRid'
	});

	self.roster = ko.observableArray();
	self.rosterMap = ko.computed(function() {
		var result = {};
		_.forEach(self.roster(), function(element) {
			result[element] = true;
		});
		return result;
	});

	self.presenceType = ko
			.observable(/* 'available' | 'away' | 'dnd' | 'unavailable' | 'xa' */);
	self.presenceStatus = ko.observable( /* string set by user */);
	self.updatePresence = function() {
		var type = self.presenceType();
		var status = self.presenceStatus();

		if (!connection)
			return;

		var payload = {};
		if (type)
			payload.type = type;
		if (status)
			payload.status = status;
		connection.send($pres(payload));
	};
	self.updatePresenceRule = ko.computed(self.updatePresence);

	
	/////// PA CHAT
	var paGrpMsgHandler;
	self.setGrpMsgHandler = function(handler) {
		paGrpMsgHandler = handler;
	};
	
	var resultMsgHandler;
	self.setResultMsgHandler = function(handler) {
		resultMsgHandler = handler;
	};
	
	var errorMsgHandler;
	self.setErrorMsgHandler = function(handler) {
		errorMsgHandler = handler;
	};
	
	var connectHandler;
	self.setConnectHandler = function(handler) {
		connectHandler = handler;
		if (connection && connection.connected) {
			handler();
		}
	};
	/////// PA CHAT	
	
	var paMsgHandler;
	var paPresenceHandler;
	var paCommandHandler;
	self.setMsgHandler = function(handler) {
		paMsgHandler = handler;
	}

	self.setPresenceHandler = function(handler) {
		paPresenceHandler = handler;
	}
	self.setCommandHandler = function(handler) {
		paCommandHandler = handler;
	}

	self.connectOrResume = function() {
		connection = new Strophe.Connection('http://' + SERVICE_URL
				+ ':5280/http-bind');
		connection.rawInput = rawInput;
		connection.rawOutput = rawOutput;

		if (self.jid() && self.sid() && self.rid()) {
			log('Attempting to attach. jid:' + self.jid() + ' sid:'
					+ self.sid() + ' rid:' + self.rid());
			connection.attach(self.jid(), self.sid(), self.rid(), onConnect);
		} else if (self.uberId() && self.jabberToken()) {
			log('Attempting to connect');
			self.jid(UberidToJid(self.uberId()) + '/PA');
			connection.connect(self.jid(), self.jabberToken(), onConnect);
		} else {
			log('Unable to connect to jabber');
		}
		connection_attempts++;
	}

	self.saveSessionState = function() {
		if (connection && connection.connected) {
			self.sid(connection._proto.sid);
			self.rid(connection._proto.rid);
		}
	}

	self.addContact = function(uberid) {

		if (!connection.connected)
			return;

		var jid = UberidToJid(uberid);

		var iq = $iq({
			type : "set"
		}).c("query", {
			xmlns : "jabber:iq:roster"
		}).c("item", jid);
		connection.sendIQ(iq);

		connection.send($pres({
			to : jid,
			type : "subscribe"
		}));
	}

	self.removeContact = function(uberid) {

		if (!connection.connected)
			return;

		var jid = UberidToJid(uberid);
		connection.send($pres({
			to : jid,
			type : "unsubscribe"
		}));
		connection.send($pres({
			to : jid,
			type : "unsubscribed"
		}));
	}

	self.sendChat = function(uberid, message) {

		if (!connection.connected || !uber_id || !message)
			return;

		var jid = UberidToJid(uberid);
		var msg = $msg({
			to : jid,
			type : 'chat'
		}).c('body').t(message);
		connection.send(msg);
	}
	
	
	/////////// PA CHAT
	
	var nameInChannels ={};
	
	self.leaveGroupChat = function(roomName) {
		if (!connection.connected || !roomName) {
			return;
		}
		connection.send($pres({from: self.jid(), to: roomName+"@"+CONFERENCE_URL+"/"+nameInChannels[roomName], type: "unavailable"}));
		delete nameInChannels[roomName];
	};
	
	self.joinGroupChat = function(roomName, league, rank, name) {
		if (!connection.connected || !roomName || !self.jid()) {
			return;
		}
		nameInChannels[roomName] = name;
		
		connection.send($pres({from: self.jid(), to: roomName+"@"+CONFERENCE_URL+"/"+name,
			league: league, rank: rank}));
	};
	
	self.setChannelPresence = function(roomName, presence) {
		if (!connection.connected || !roomName || !self.jid() || !presence) {
			return;
		}
		connection.send($pres({from: self.jid(), to: roomName+"@"+CONFERENCE_URL+"/"+nameInChannels[roomName]}).c("show").t(presence));
	};
	
	self.sendGroupChat = function(roomName, message) {
		if (!connection.connected || !roomName || !message) {
			return;
		}
		connection.send($msg({to: roomName+"@"+CONFERENCE_URL, type: "groupchat"}).c('body').t(message));
	};
	
	var adminActions = {};
	
	self.muteUser = function(roomName, nick, reason) {
		self.adminUser(roomName, nick, 'mute', reason);
	};
	
	self.unmuteUser = function(roomName, nick, reason) {
		self.adminUser(roomName, nick, 'unmute', reason);
	};
	
	self.kickUser = function(roomName, nick, reason) {
		self.adminUser(roomName, nick, 'kick', reason);
	};
	
	var operation = { 
		kick : 'none',
		mute : 'visitor',
		unmute : 'participant' 
	};
	
	self.adminUser = function(roomName, nickname, action, reason) {
		if (!connection.connected || !roomName || !nickname || !operation) {
			return;
		}
		var iq = $iq({
 			from: self.jid(), to: roomName+"@"+CONFERENCE_URL, type : 'set'
		}).c(
			'query', {xmlns : 'http://jabber.org/protocol/muc#admin'}
		).c(
			'item', {nick : nickname, role : operation[action]}
		);
		if (reason) {
			iq.c('reason').t(reason);
		}
		
		var id = connection.sendIQ(iq, onIqSuccess, onIqError);
		
		adminActions[id] = {user : nickname, action : action, reason : reason, room : roomName};
	};
	
	self.banUser = function(roomName, uberId, reason) {
		if (!connection.connected || !roomName || !uberId) {
			return;
		}
		var iq = $iq({
 			from: self.jid(), to: roomName+"@"+CONFERENCE_URL, type : 'set'
		}).c(
			'query', {xmlns : 'http://jabber.org/protocol/muc#admin'}
		).c(
			'item', {affiliation : 'outcast',jid : UberidToJid(uberId)}
		);
		if (reason) {
			iq.c('reason').t(reason);
		}
		
		var id = connection.sendIQ(iq, onIqSuccess, onIqError);
		
		adminActions[id] = {uberId : uberId, action : 'ban', reason : reason, room : roomName};
	};
	
	self.unbanUser = function(roomName, uberId) {
		if (!connection.connected || !roomName || !uberId) {
			return;
		}
		var iq = $iq({
 			from: self.jid(), to: roomName+"@"+CONFERENCE_URL, type : 'set'
		}).c(
			'query', {xmlns : 'http://jabber.org/protocol/muc#admin'}
		).c(
			'item', {affiliation : 'none', jid : UberidToJid(uberId)}
		);
		
		var id = connection.sendIQ(iq, onIqSuccess, onIqError);
		adminActions[id] = {uberId : uberId, action : 'unban', reason : '', room : roomName};
	};
	
	self.showBanList = function(roomName) {
		if (!connection.connected || !roomName) {
			return;
		}
		var iq = $iq({
 			from: self.jid(), to: roomName+"@"+CONFERENCE_URL, type : 'get'
		}).c(
			'query', {xmlns : 'http://jabber.org/protocol/muc#admin'}
		).c(
			'item', {affiliation : 'outcast'}
		);
		
		var id = connection.sendIQ(iq, onIqSuccess, onIqError);
		adminActions[id] = {user : '', action : 'banlist', reason : '', room : roomName};
	};
	
	var onIqSuccess = function (message) {
		var instance = adminActions[message.getAttribute('id')];
		
		if (instance.action === 'banlist') {
			var items = message.firstChild.getElementsByTagName('item');
			var banned = [];
			
			for (var i = 0; i < items.length; i++) {
				var uberId = JidToUberid(items[i].getAttribute('jid'));
				var reason = Strophe.getText(items[i].firstChild);
					
				reason = reason ? htmlSpecialChars(reason, true) : '';
					
				banned.push({uberId : uberId, reason : reason});
			}
			resultMsgHandler(instance.room, 'banlist', banned);
		}
		else {
			resultMsgHandler(instance.room, instance.action, {uberId : instance.uberId, user : instance.user, reason : instance.reason});
		}
	};
	
	var onIqError = function (message) {
		var instance = adminActions[message.getAttribute('id')];
		
		var errors = message.getElementsByTagName('error');
		var explanation = '';
		
		for (var i = 0; i < errors.length; i++) {
			explanation += 'Failed because ' + errors[i].firstChild.nodeName;
			explanation +=  errors[i].getElementsByTagName('text')[0] ? '. Explanation: ' + Strophe.getText(errors[i].getElementsByTagName('text')[0]) : '';
		}
		
		console.log(explanation);
		
		errorMsgHandler(instance.room, instance.action, {uberId : instance.uberId, user : instance.user,  explanation : explanation} );
	};
	
	/////////// PA CHAT
	
	self.sendCommand = function(uberid, type, payload) {
		var jid = UberidToJid(uberid);
		var message = JSON.stringify({
			message_type : type,
			payload : payload
		});
		log(message);
		connection.send($msg({
			to : jid,
			type : 'command'
		}).c('body').t(message));
	}

	self.getRoster = function() {
		var iq = $iq({
			type : 'get'
		}).c('query', {
			xmlns : 'jabber:iq:roster'
		});
		connection.sendIQ(iq);
	}

	function JidToUberid(jid) {
		return jid.split('@')[0];
	}

	function UberidToJid(uberid) {
		return uberid + '@' + SERVICE_URL;
	}

	function onConnect(status) {
		log('!!! onConnect');
		switch (status) {
		case Strophe.Status.CONNECTING:
			log('!!!Strophe is connecting to ' + SERVICE_URL + ' as '
					+ self.jid());
			break;
		case Strophe.Status.CONNFAIL:
			log('Strophe failed to connect.');
			break;
		case Strophe.Status.DISCONNECTING:
			log('Strophe is disconnecting.');
			break;
		case Strophe.Status.DISCONNECTED:
			log('Strophe is disconnected.');
			self.jid(undefined);
			self.sid(undefined);
			self.rid(undefined);
			if (connection_attempts < MAX_RETRIES) {
				log('Attempting to reconnect to XMPP. Tries:'
						+ connection_attempts);
				setTimeout(connectOrResume, 3000);
			}
			break;
		case Strophe.Status.CONNECTED:
			log('!!!Strophe is connected as ' + self.jid());
			initHandlers();
			self.getRoster();
			connection.send($pres());
			connection_attempts = 0;
			
			/// PA CHAT
			if (connectHandler) {
				connectHandler();
			}
			// PA CHAT
			
			break;
		case Strophe.Status.ATTACHED:
			log('!!!Strophe is attached as ' + self.jid());
			initHandlers();
			self.getRoster();
			connection.send($pres());
			connection_attempts = 0;

			/// PA CHAT
			if (connectHandler) {
				connectHandler();
			}
			// PA CHAT
			
			
			break;
		case Strophe.Status.AUTHENTICATING:
			log('Strophe is authenticating.');
			break;
		case Strophe.Status.AUTHFAIL:
			log('Strophe failed to authenticate.');
			break;
		case Strophe.Status.ERROR:
			log('Strophe onConnect Error.');
			break;
		default:
			log('!!!Strophe unexpected status type');
			break;
		}
	}

	function initHandlers() {
		if (connection && connection.connected) {
			connection.addHandler(onPresence, null, 'presence', null, null,
					null);
			connection.addHandler(onRoster, null, 'iq', null, null, null);
			connection.addHandler(onCommand, null, 'message', 'command', null,
					null);
			connection.addHandler(onMessage, null, 'message', 'chat', null,
					null);
			connection.addHandler(onGrpChat, null, "message", 'groupchat', null, null);
		}
	}
	
	function onGrpChat(message) {
		try {
			var x = message.getElementsByTagName("x");

			var stati = [];
			if (x && x.length > 0) {
				var status = x[0].getElementsByTagName("status");
				if (status) {
					for (var i = 0; i < status.length; i++) {
						stati.push($(status[i]).attr("code"));
					}
				}
			}
			
			var body = message.getElementsByTagName('body');
			
			var from = $(message).attr('from');
			var room = from.split('@')[0];
			
			var content = '';
			if (Strophe.getText(body[0]))
				content = htmlSpecialChars(Strophe.getText(body[0]), true);
			
			var delay = message.getElementsByTagName("delay");
			var timestamp = new Date().getTime();
			if (delay.length === 1) {
				var dt = new Date($(delay[0]).attr("stamp")).getTime();
				timestamp = dt;
				
				// fix cases of "history from the future" due to the servertime of the xmpp server being rather questionable... 7 minutes ahead of reality
				if (new Date().getTime() < timestamp) {
					timestamp = new Date().getTime() - (1000 * 5); 
				}
			}
			
			paGrpMsgHandler(room, from, stati, content, timestamp);
		} catch (e) {
			log("!!! group chat error");
			console.log(e);
		} finally {
			return true;
		}
	}
	
	function onPresence(message) {
		log("onPresence");
		try {
			var type = $(message).attr('type');
			var from = $(message).attr('from');
			var to = $(message).attr('to');
			var status = $(message).attr('status');
			
			log('jabber::onPresence');
			log(message);
			log(type);
			log(status);
			log(from);
			
			/* store jid so we can broadcast status changes */
			if (!jabber.rosterMap()[from])
				jabber.roster.push(from);

			if (type === 'subscribe') {
				// Allow
				connection.send($iq({
					type : "set"
				}).c("query", {
					xmlns : "jabber:iq:roster"
				}).c("item", from));
				connection.send($pres({
					to : from,
					type : "subscribe"
				}));
				connection.send($pres({
					to : from,
					type : 'subscribed'
				}));

				// Block
				// connection.send($pres({ to: from, "type": "unsubscribed" }));
			} else {
				// PA CHAT
				var isGrpChat = from.indexOf(CONFERENCE_URL) !== -1;
				
				var user = JidToUberid(from);
				var chatRoom = undefined;
				var userinfo = {};
				var stati = [];
				var fullChannelName = undefined;
				
				if (isGrpChat) {
					
					if (!type) {
						var show = message.getElementsByTagName("show");
						if (show && show.length > 0 && Strophe.getText(show[0])) {
							type = htmlSpecialChars(Strophe.getText(show[0]), true);
						};
					}
					
					chatRoom = user; // for grp chats the name of the room is in front of the @conference.xmpp....
					
					fullChannelName = from;
					
					userinfo.league = $(message).attr('league');
					userinfo.rank = $(message).attr('rank');
					
					var x = message.getElementsByTagName("x");
					
					if (x && x.length > 0) {
						var children = $(x).children();
						if (children) {
							for (var i = 0; i < children.length; i++) {
								var child = $(children[i]);
								if (child[0].nodeName === "item") {
									userinfo.affiliation = $(child[0]).attr("affiliation");
									userinfo.role = $(child[0]).attr("role");
									user = JidToUberid($(child[0]).attr("jid"));
									
								} else if (child[0].nodeName === "status") {
									// probably required to handle kick/ban messages
								}
							}
						}
					}
					
					
					if (x && x.length > 0) {
						var stt = x[0].getElementsByTagName("status");
						if (stt) {
							for (var i = 0; i < stt.length; i++) {
								stati.push($(stt[i]).attr("code"));
							}
						}
					}
				}
				
				paPresenceHandler(user, type || 'available',
						status, isGrpChat, chatRoom, userinfo, stati, fullChannelName);
				
				 // PA CHAT
			}

			return true;
		}
		// If the handler doesn't return true, it will be deleted
		catch (e) {
			log('!!!PRESENCE error:' + e);
			return true;
		}
	};

	function onRoster(message) {
		log("onRoster");
		try {
			var type = $(message).attr('type');
			var from = $(message).attr('from');
			var to = $(message).attr('to');
			var xmlns = $(message).attr('xmlns');
			var id = $(message).attr('id');
			
			//PA Chat only results for banned users
			
			if (Object.keys(adminActions).indexOf(id) !== -1) {
				//those are handled in onIqSuccess and onIqError
				/*
				if (id === lastShowBanId) {
					
				}
				else {
					log(message);
					errorMsgHandler(from.split('@')[0], 'INFO', 'lol'); //TODO
				}
				*/
			}			
			//PA CHat	
			
			else if (message.firstChild) {
				var items = message.firstChild.getElementsByTagName('item');
				for (var i = 0; i < items.length; i++) {

					var jid = items[i].getAttribute('jid');
					var name = items[i].getAttribute('name');
					var sub = items[i].getAttribute('subscription');
					var ask = items[i].getAttribute('ask');

					/* store jid so we can broadcast status changes */
					if (!jabber.rosterMap()[jid])
						jabber.roster.push(jid);
					
// trigger the fix in the presencehandler in uberbar.js. undefined, undefined prevents this from doing anything else
// so make sure all jabber friends are known as "friends" by PA.
if (paPresenceHandler) {
	paPresenceHandler(JidToUberid(jid), undefined, undefined, from.indexOf(CONFERENCE_URL) !== -1);
}
					log('!!!   jid:' + jid + ' name:' + name + ' sub:' + sub
							+ ' ask:' + ask);
					connection.send($pres({
						to : jid,
						type : "probe"
					}));
				}
			}

			if (type === 'set') {
				var iq = $iq({
					type : 'result',
					to : from,
					id : id
				});
				connection.sendIQ(iq);
			}
			return true;
		}
		// If the handler doesn't return true, it will be deleted
		catch (e) {
			log('!!!IQ error:' + e);
			return true;
		}
	};

	function onMessage(message) {
		log("onMessageHandler");
		try {
			var from = message.getAttribute('from');
			var to = message.getAttribute('to');
			var type = message.getAttribute('type');
			var body = message.getElementsByTagName('body');

			from = JidToUberid(from);
			
			var content = '';
			if (Strophe.getText(body[0]))
				var content = Strophe.getText(body[0]);

			paMsgHandler(from, htmlSpecialChars(content, true));
			return true;
		}
		// If the handler doesn't return true, it will be deleted
		catch (e) {
			log('!!!MESSAGE error:' + e);
			return true;
		}
	}

	function onCommand(message) {
		log("onCommandHandler");
		try {
			var from = message.getAttribute('from');
			var to = message.getAttribute('to');
			var type = message.getAttribute('type');
			var body = message.getElementsByTagName('body');

			var content = '';
			if (Strophe.getText(body[0]))
				content = Strophe.getText(body[0]);

			var command = JSON.parse(htmlSpecialChars(content, true))

			paCommandHandler(JidToUberid(from), command);
			return true;
		}
		// If the handler doesn't return true, it will be deleted
		catch (e) {
			log('!!!MESSAGE error:' + e);
			return true;
		}
	}

	function rawInput(data) {
		log("RECEIVED: "+formatXml(data));
		self.saveSessionState();
	}

	function rawOutput(data) {
		log('SENT: ' + formatXml(data));
		self.saveSessionState(); /*
									 * attempting to save the sid and rid when
									 * it changes
									 */
	}

	// http://stackoverflow.com/questions/376373/pretty-printing-xml-with-javascript
	function formatXml(xml) {
		var formatted = '';
		var reg = /(>)(<)(\/*)/g;
		xml = xml.replace(reg, '$1\r\n$2$3');
		var pad = 0;
		jQuery.each(xml.split('\r\n'), function(index, node) {
			var indent = 0;
			if (node.match(/.+<\/\w[^>]*>$/)) {
				indent = 0;
			} else if (node.match(/^<\/\w/)) {
				if (pad != 0) {
					pad -= 1;
				}
			} else if (node.match(/^<\w[^>]*[^\/]>.*$/)) {
				indent = 1;
			} else {
				indent = 0;
			}

			var padding = '';
			for (var i = 0; i < pad; i++) {
				padding += '  ';
			}

			formatted += padding + node + '\r\n';
			pad += indent;
		});

		return formatted;
	}
}

function initJabber(payload) {
	jabber = new Jabberer(payload.uber_id, payload.jabber_token,
			payload.use_ubernetdev);
	jabber.connectOrResume();

	var restoreJabber = ko.observable().extend({
		session : 'restore_jabber'
	});
	restoreJabber(true);
}

(function() {
	var restoreJabber = ko.observable().extend({
		session : 'restore_jabber'
	});
	if (restoreJabber()) {
		jabber = new Jabberer();
		jabber.connectOrResume();
	}
})();

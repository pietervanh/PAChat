(function() {
	loadScript("coui://ui/main/shared/js/matchmaking_utility.js");
	
	ko.bindingHandlers.resizable = {
		    init: function(element, valueAccessor) {
		         var options = valueAccessor();
		         $(element).resizable(options);
		    }  
		};
	
	// had to copy this due to visibility reasons, unmodified function
	/* an ubernet user you have encounterd: includes friends, recent contacts, ignored, blocked */
    function UserViewModel(id) {
        var self = this;
        //console.log('new UserViewModel');

        self.uberId = ko.observable(id);
        self.displayName = ko.observable(model.userDisplayNameMap()[id]);
        
        
        self.pendingChat = ko.observable(false);

        self.tags = ko.observable({});
        self.tagList = ko.computed(function () {
            var result = [];

            _.forEach(self.tags(), function (element, key) {
                if (element)
                    result.push(key);
            });

            return result;
        });

        function updateTags() {
            var result = model.userTagMap()[id];
            self.tags(result ? result : {});
        }
        updateTags();

        self.friend = ko.computed(function () { return self.tags()['FRIEND'] });
        self.pendingFriend = ko.computed(function () { return self.tags()['PENDING_FRIEND'] });
        self.allowChat = ko.computed(function () { return self.friend() || self.tags()['ALLOW_CHAT'] });
        self.ignored = ko.computed(function () { return self.tags()['IGNORED'] });
        self.blocked = ko.computed(function () { return self.tags()['BLOCKED'] });
        self.search = ko.computed(function () { return self.tags()['SEARCH'] });

        self.lastInteractionTime = ko.computed(function () { return model.idToInteractionTimeMap()[self.uberId()] });

        self.hasName = ko.computed(function () { self.displayName() });

        self.presenceType = ko.computed(function () {
            if (!model.idToJabberPresenceTypeMap())
                return 'unavailable';
            var result = model.idToJabberPresenceTypeMap()[self.uberId()];
            return result || 'unavailable';
        });
        self.available = ko.computed(function () { return self.presenceType() === 'available' });
        self.away = ko.computed(function () { return self.presenceType() === 'away' });
        self.dnd = ko.computed(function () { return self.presenceType() === 'dnd' });
        self.offline = ko.computed(function () { return self.presenceType() === 'unavailable' });
        self.status = ko.computed(function () {
            if (!model.idToJabberPresenceStatusMap())
                return '';
            var s = model.idToJabberPresenceStatusMap()[self.uberId()];
            return (s && s !== 'undefined') ? s : '';
        });
        self.online = ko.computed(function () { return !self.offline() });

        self.requestUserName = function () {
            engine.asyncCall('ubernet.call', '/GameClient/UserName?UberId=' + self.uberId(), false)
                   .done(function (data) {
                       var result = JSON.parse(data);
                       model.changeDisplayNameForId(id, result.TitleDisplayName);
                       self.displayName(model.userDisplayNameMap()[id]);
                   })
                   .fail(function (data) {
                       console.log('ubernet.UserName: fail');
                   });
        }

        if (!self.hasName())
            self.requestUserName();

        self.startChat = function () {
            var exists = model.conversationMap()[self.uberId()];
            if (exists)
                exists.minimized(false);
            else
                model.startConversationsWith(self.uberId())
        };
        self.startChatIfOnline = function () {
            if (self.offline())
                return;
            self.startChat()
        }
        self.sendReply = function () {
            jabber.sendChat(self.partnerUberId(), self.reply());
            self.messageLog.push({ 'name': model.uberId, 'message': self.reply() });
            self.reply('');
        };

        self.sendChatInvite = function () {
            self.pendingChat(true);
            self.startChat();

            jabber.sendCommand(self.uberId(), 'chat_invite');
        }

        self.acceptChatInvite = function () {
            if (!self.pendingChat()) {
                self.pendingChat(true); //this is done to allow chat while ALLOW_CHAT tag is being added
                self.startChat();
                jabber.sendCommand(self.uberId(), 'accept_chat_invite');
            }

            self.addTag('ALLOW_CHAT', function () { self.pendingChat(false)});
            self.startChat();
        }

        self.declineChatInvite = function () {
            if (!self.pendingChat())
                jabber.sendCommand(self.uberId(), 'decline_chat_invite');
        }

        self.sendFriendRequest = function () {
            if (self.friend())
                return;

            self.addTag('PENDING_FRIEND');
            jabber.sendCommand(self.uberId(), 'friend_request');
        }
        self.acceptFriendRequest = function () {
            if (!self.pendingFriend())
                jabber.sendCommand(self.uberId(), 'accept_friend_request');

            self.addTag('FRIEND', function () { self.removeTag('PENDING_FRIEND') });
            jabber.addContact(self.uberId());
        }
        self.declineFriendRequest = function () {
            if (!self.pendingFriend())
                jabber.sendCommand(self.uberId(), 'decline_friend_request');

            self.removeTag('PENDING_FRIEND');
        }
        self.unfriend = function () {
            self.removeTag('FRIEND');
            jabber.removeContact(self.uberId());
        }
        self.sendUnfriend = function () {
            if (!self.friend())
                return;

            self.unfriend();
            jabber.sendCommand(self.uberId(), 'unfriend');
        }
        
        self.sendInviteToGame = function () {
            jabber.sendCommand(self.uberId(), 'game_invite');

            model.pendingGameInvites()[self.uberId()] = model.lobbyInfo() ? model.lobbyInfo().lobby_id : false;

            if (!model.lobbyInfo())
                api.Panel.message('game', 'create_lobby');
        }

        self.acceptInviteToGame = function () {
            model.acceptedGameInviteFrom(self.uberId());
            jabber.sendCommand(self.uberId(), 'accept_game_invite');
        }
        self.declineInviteToGame= function () {
            jabber.sendCommand(self.uberId(), 'decline_game_invite');
        }

        self.viewProfile = function () { }
        self.report = function () {
            self.block();
        }

        self.remove = function () {
            self.sendUnfriend();
            model.removeAllUserTagsFor(self.uberId());
            updateTags();     
            _.defer(model.requestUbernetUsers);
        }

        self.addTag = function (tag, callback) {
            model.addUserTags(self.uberId(), [tag]);
            updateTags();
            if (callback)
                callback();
        }

        self.removeTag = function (tag, callback) {
            model.removeUserTags(self.uberId(), [tag]);
            updateTags();
            if (callback)
                callback();
        }

        self.block = function () {
            self.addTag('BLOCKED', self.sendUnfriend);
            jabber.removeContact(self.uberId());
        }

        self.unblock = function () {
            self.removeTag('BLOCKED');           
        }
     
    };
    // end of copied code
	
	var makeChatRoomUser = function(uberid, admin, mod, rankData) {
		var obj = new UserViewModel(uberid);
		obj.isModerator = ko.observable(mod);
		obj.isAdmin = ko.observable(admin);
		obj.rank = ko.observable("provisional");
		obj.rankImg = ko.computed(function() {
			return MatchmakingUtility.getSmallBadgeURL(obj.rank());
		});
		
		if (rankData) { 
			obj.rank(rankData);
		}
		
        // PA CHAT
        obj.displayNameComputed = ko.computed(function() {
        	return (obj.displayName() ? obj.displayName() : obj.uberId())+"";
        });
        // PA CHAT
		
		return obj;
	};
	
	var oldPresence = model.onPresence;
	model.onPresence = function(uid, pt, ps, grpChat, chatRoom, userinfo, stati) {
		
		console.log(arguments);
		
		if (uid && !grpChat) { // a fix for cases of "my friendlist is empty"
			var tagMap = model.userTagMap();
			var tags = tagMap[uid] || {};
			tags["FRIEND"] = true;
			tagMap[uid] = tags;
			model.userTagMap(tagMap)

			for (var i = 0; i < model.users().length; i++) {
				// trigger the computed friends() within the users. No idea why
				// that does not work automatically,
				// the hierarchy of the computes in this file is ... not easy to
				// understand
				model.users()[i].tags(model.users()[i].tags());
			}
		}
		
		if (grpChat) {
			if (uid !== model.uberId() || pt !== "unavailable") {
				var r = model.chatRoomMap()[chatRoom];
				if (!(r && r.usersMap()[uid])) {
					var userModel = makeChatRoomUser(uid, userinfo.affiliation === "owner" 
						|| userinfo.affiliation === "admin", userinfo.role === "moderator", userinfo.rank);
					model.insertUserIntoRoom(chatRoom, userModel);
				} else {
					model.removeUserFromRoom(chatRoom, uid);
				}
			} else {
				delete model.chatRoomMap()[chatRoom];
				model.chatRoomMap.notifySubscribers();
			}
		}
		oldPresence(uid, pt, ps);
	};

	var oldMessage = model.onMessage;
	model.onMessage = function(uberid, message) {
		oldMessage(uberid, message);
	};
	
	var oldCommand = model.onCommand;
	model.onCommand = function(uberid, cmd) {
		oldCommand(uberid, cmd);
	};
	
	model.onGrpChat = function(room, user, stati, content, timestamp) {
		if (content && user) {
			var r = model.chatRoomMap()[room];
			var userModel = undefined;
			if (r) {
				userModel = r.usersMap()[user];
			}
			if (!userModel) {
				userModel = makeChatRoomUser(user, false, false); // TODO this might not work correctly on joining if the presence and the messages are switched up
			}
			model.insertMessageIntoRoom(room, {
				user: userModel,
				content: content,
				time: timestamp
			});
			
			if (content.indexOf(model.displayName()) !== -1 && (new Date().getTime() - timestamp) < 10 * 1000) {
				api.game.outOfGameNotification("You were mentioned in channel " + room + " by " + userModel.displayNameComputed());
			}
		}
	};
	
	var oldSetup = model.setup;
	model.setup = function() {
		// prevent the default code from killing scrolling
		var scrollW = window.onmousewheel;
		var scrollD = document.onmousewheel;
		oldSetup();
		window.onmousewheel = scrollW;
		document.onmousewheel = scrollD;
		if (decode(sessionStorage['restore_jabber'])) {
			jabber.setGrpMsgHandler(model.onGrpChat);
		}
	};
	
	model.myRank = ko.observable();
	
	var initRank = function(cb) {
        engine.asyncCall('ubernet.getPlayerRating', 'Ladder1v1').done(function (data) {
        	try {
        		var d = JSON.parse(data);
        		model.myRank(d.Rating)
        	} catch (e) {
        		console.log("failed to get player rank!");
        		console.log(e);
        	} finally {
        		cb();
        	}
        }).fail(function (data) {
        	console.log("hard fail to get player rank");
        	console.log(data);
        	cb();
        });
	};
	
	var oldJabberAuth = handlers.jabber_authentication;
	handlers.jabber_authentication = function(payload) {
		oldJabberAuth(payload);
		jabber.setGrpMsgHandler(model.onGrpChat);
		jabber.setConnectHandler(function() {
			initRank(function() {
				model.joinChatRoom("halcyon");
			});
		});
	};
	
	function ChatRoomModel(roomName) {
		var self = this;
		
		self.roomName = ko.observable(roomName);
		self.minimized = ko.observable(false);
		self.messages = ko.observableArray([]); // objects like {user, content, time}
		self.sortedMessages = ko.computed(function() {
			return self.messages().sort(function(a, b) {
				return a.time - b.time; 
			});
		});
		self.lastMessage = ko.computed(function() {
			return self.sortedMessages()[self.sortedMessages().length-1];
		});
		self.usersMap = ko.observable({}); // mapping uberid > chat room UserViewModel
		self.sortedUsers = ko.computed(function() {
			return _.values(self.usersMap()).sort(function(a, b) {
				if ((a.isModerator() && b.isModerator())
						|| (!a.isModerator() && !b.isModerator())) {
					return a.displayNameComputed().localeCompare(b.displayNameComputed());
				} else  {
					return (a.isModerator() && !b.isModerator()) ? -1 : 1;
				}
			});
		});
		
		self.toggleMinimized = function() {
			self.minimized(!self.minimized());
		};
		self.maximize = function() {
			self.minimized(false);
		};
		self.minimized.subscribe(function(value) {
			if (!value) {
				self.dirty(false);
			}
			self.scrollDown();
		});
		
		self.scrollDown = function() {
			setTimeout(function() {
				if ($('#chat_'+self.roomName()).length > 0) {
					$('#chat_'+self.roomName()).scrollTop($('#chat_'+self.roomName())[0].scrollHeight);
				}
			}, 0); // TODO HACK
		};
		
		self.addMessage = function(message) {
			self.messages.push(message);
			self.dirty(self.minimized());
		};

		self.dirty = ko.observable(false);
		
		self.messageLine = ko.observable('');
		self.sendMessageLine = function() {
			if (self.messageLine().startsWith("/")) {
				self.handleCommand(self.messageLine());
			} else {
				jabber.sendGroupChat(self.roomName(), self.messageLine());
			}
			self.messageLine('');
		};
		
		self.tryAnnounceLobby = function(msg) {
			self.writeSystemMessage("TODO: IMPLEMENT THIS FUNCTION"); // TODO
		};
		
		self.handleCommand = function(cmd) {
			if (cmd === "/help") {
				self.writeSystemMessage("You can minimize PA, if somebody will write your name PA will blink.");
				self.writeSystemMessage("You can write the beginning of a name and press tab to autocomplete.");
				self.writeSystemMessage("Available commands, try /help <command> for more info: announcelobby join");
			} else if (cmd.startsWith("/help announcelobby")) {
				self.writeSystemMessage("/announcelobby <msg> can be used to advertise a lobby you are currently in. Only works while in a public lobby")
			} else if (cmd.startsWith("/help join")) {
				self.writeSystemMessage("/join <channelname> joins a chatchannel. If the channel does not exist it will be created");
			} else if (cmd.startsWith("/announcelobby")) {
				self.tryAnnounceLobby(cmd.replace("/announcelobby ", ""));
			} else if (cmd.startsWith("/join")) {
				model.joinChatRoom(cmd.replace("/join ", "").trim());
			} else {
				self.writeSystemMessage("unknown command: "+cmd);
			}
		};
		
		self.close = function() {
			model.leaveRoom(self.roomName());
		};
		
		self.writeSystemMessage = function(msg) {
			var fake = makeChatRoomUser(model.uberId(), false, false);
			fake.displayNameComputed = ko.observable("");
			self.addMessage({
				user: fake,
				content: msg,
				time: new Date().getTime()
			});
		};
		
		self.tryFillInTypedName = function() {
			var words = self.messageLine().split(" ");
			if (words) {
				var lastWord = words[words.length - 1];
				var candidates = [];
				if (lastWord) {
					for (var i = 0; i < self.sortedUsers().length; i++) {
						var user = self.sortedUsers()[i];
						
						console.log(user.displayName() + " vs " + lastWord);
						
						if (user.displayName().startsWith(lastWord)) {
							candidates.push(user.displayName());
						}
					}
				}
				
				if (candidates.length === 1) {
					self.messageLine(self.messageLine().slice(0, self.messageLine().length - lastWord.length) + candidates[0]);
				} else if (candidates.length > 1) {
					var lst = "";
					for (var i = 0; i < candidates.length; i++) {
						lst += candidates[i] + " ";
					}
					self.writeSystemMessage(lst);
				}
			}
		};
		
		self.inputKeyDown = function(s, event) {
			if (event.which === 9) {
				self.tryFillInTypedName();
				return false;
			} else {
				return true;
			}
		};
	}
	
	model.chatRoomMap = ko.observable({/* roomName: ChatRoomModel */});
	model.chatRooms = ko.computed(function() {
		return _.values(model.chatRoomMap());
	});
	
	var getOrCreateRoom = function(roomName) {
		var room = model.chatRoomMap()[roomName];
		if (!room) {
			model.chatRoomMap()[roomName] = new ChatRoomModel(roomName);
			model.chatRoomMap.notifySubscribers();
			room = model.chatRoomMap()[roomName];
			room.scrollDown();
			
			
			// TODO remember last state instead and have a preconfiguration for halcyon
			if (roomName === "halcyon") {
				setTimeout(function() {
					room.minimized(true);
					room.dirty(false);
				}, 0); // ... I wish I knew why this is necessary to prevent if from breaking
			}
		}
		return room;
	};
	
	model.insertUserIntoRoom = function(roomName, user) {
		getOrCreateRoom(roomName).usersMap()[user.uberId()] = user;
		getOrCreateRoom(roomName).usersMap.notifySubscribers();
	};
	
	model.removeUserFromRoom = function(roomName, userid) {
		delete getOrCreateRoom(roomName).usersMap()[userid];
		getOrCreateRoom(roomName).usersMap.notifySubscribers();
	};
	
	model.insertMessageIntoRoom = function(roomName, message) {
		getOrCreateRoom(roomName).addMessage(message);
	};
	
	model.joinChatRoom = function(roomName) {
		console.log("try join "+roomName);
		var room = model.chatRoomMap()[roomName];
		if (room) {
			room.minimized(false);
		} else {
			jabber.joinGroupChat(roomName, model.myRank());
		}
	};
	
	model.leaveRoom = function(roomName) {
		var room = model.chatRoomMap()[roomName];
		if (room) {
			jabber.leaveGroupChat(room.roomName());
		}
	}
	
	var oldContextMenu = model.contextMenuForContact;
	model.contextMenuForContact = function(data, event) {
		if (data.uberId() !== model.uberId() && event.type === "contextmenu") { // knockout should do this for me, but somehow it does not?!
			oldContextMenu(data, event);
		}
	}
	
	
	model.joinChannelName = ko.observable('');
	
	
	
	
	// black magic http://stackoverflow.com/questions/805107/creating-multiline-strings-in-javascript/5571069#5571069
	function multiLines(f) {
		  return f.toString().replace(/^[^\/]+\/\*!?/, '').replace(/\*\/[^\/]+$/, '');
	}
	
	var joinHtmlSnip = multiLines(function(){/*!
	
<div class="div-seach-cont" style="padding: 1px">
    <form data-bind="submit: function () { model.joinChatRoom(model.joinChannelName()); model.joinChannelName(''); }">
        <input type="text" style="width: 100%;" placeholder="Join Chatroom (try halcyon)" value="" class="input_text input_chat_text" data-bind="value: joinChannelName" />
    </form>
</div>

*/});
	$('.div-seach-cont').parent().append(joinHtmlSnip);
	
	var chatRoomsHtmlSnip = multiLines(function() {/*!
		
                <!-- ko foreach: chatRooms -->
                <div class="div-win" style="margin-bottom:-36px;">
                    <div class="div-chat-room-window" data-bind="resizable: {minWidth: 300, handles : 'w', resize: function(event,ui) {$('.div-chat-room-window').css('left', 0);}}">
                        <div class="div-chat-header" data-bind="css: { 'dirty': dirty }, click: toggleMinimized">
                            <div class="div-chat-room-title">
								<!-- ko ifnot: minimized -->
								<div class="div-chat-room-name" data-bind="text: roomName()+' - chat provided by PA Stats. Try /help'"></div>
								<!-- /ko -->
								<!-- ko if: minimized -->
								<div class="chat_message_preview">
									<span class="div-chat-room-name" data-bind="text: roomName"></span> - 
									<!-- ko if: lastMessage() -->
									<span class="chat_message_time" data-bind="text: new Date(lastMessage().time).toLocaleTimeString()"></span>
                                    <span data-bind="text: lastMessage().user.displayNameComputed(), css: {'chat-room-user-name': !lastMessage().user.isModerator() && !lastMessage().user.isAdmin(),
															'chat-room-moderator-name': lastMessage().user.isModerator() && !lastMessage().user.isAdmin(),
															'chat-room-admin-name': lastMessage().user.isAdmin(),
															'chat-room-self-name': model.uberId() === lastMessage().user.uberId()}"></span>:
                                    <span class="chat-msg" data-bind="text: lastMessage().content"></span>
									<!-- /ko -->
                                </div>
								<!-- /ko -->
                            </div>
                            <div class="div-chat-win-controls">
                                <div class="btn_win btn_win_min btn-chat-win-control"></div>
                                <div class="btn_win btn_win_close btn-chat-win-control" data-bind="click: close"></div>
                            </div>
                        </div>
                        <!-- ko ifnot: minimized -->
                        <div class="div-chat-room-cont">
                            <div class="div-chat-room-body" data-bind="attr: {id: 'chat_'+roomName()}">
                                <!-- ko foreach: sortedMessages -->
                                <div class="chat_message">
									<span class="chat_message_time" data-bind="text: new Date(time).toLocaleTimeString()"></span>
                                    <span data-bind="text: user.displayNameComputed(), event: {contextmenu: model.contextMenuForContact(user, event)},
									css: {'chat-room-user-name': !user.isModerator() && !user.isAdmin(),
															'chat-room-moderator-name': user.isModerator() && !user.isAdmin(),
															'chat-room-admin-name': user.isAdmin(),
															'chat-room-self-name': model.uberId() === user.uberId()}"></span>:
                                    <span class="chat-msg" data-bind="text: content"></span>
                                </div>
                                <!-- /ko -->
                                <div data-bind="autoscroll: sortedMessages"></div>
                            </div>
							<div class="div-chat-room-users ">
								<!-- ko foreach: sortedUsers -->
								<div class="chat_user" data-bind="event: {contextmenu: model.contextMenuForContact}">
									<img width="24px" height="20px" data-bind="attr: {src: rankImg()}" />
									<span data-bind="css: {'chat-room-user-name': !isModerator() && !isAdmin(),
															'chat-room-moderator-name': isModerator() && !isAdmin(),
															'chat-room-admin-name': isAdmin()}, text: displayNameComputed"></span>
								</div>
								<!--/ko -->
							</div>
                        </div>
                        <div class="div-chat-input">
                            <form data-bind="submit: sendMessageLine">
                                <input class="input-chat" type="text" data-bind="value: messageLine, valueUpdate: 'afterkeydown', event: {keydown: inputKeyDown}" autofocus />
                            </form>
                        </div>
                        <!-- /ko -->
                    </div>
                </div>
                <!-- /ko -->
                		
	*/});
	
	$('.div-social-canvas > .chat-wrapper').append(chatRoomsHtmlSnip);
	
	
	
	
	
	
}());
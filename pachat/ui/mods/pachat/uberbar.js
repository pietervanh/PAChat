(function() {

	/**
	 * scrolls to the bottom if the scrollable view was at the bottom before the value changed
	 */
    ko.bindingHandlers.autoscroll = {
            init: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
            	// right before the value changes, check if the parent of the element was scrolled to the bottom
            	var wasAtBottom = false;
            	valueAccessor().subscribe(function() {
                    if (!element || !element.parentNode)
                        return;
                    var p = element.parentNode;
                    wasAtBottom = p.scrollHeight - p.scrollTop === p.clientHeight;
            	}, null, "beforeChange");
            	
            	// right after the value changed, if the parent of the element was scrolled to the bottom, scroll it to the bottom again
                valueAccessor().subscribe(function (value) {
                    if (!element || !element.parentNode)
                        return;
                    if (wasAtBottom) {
                        element.scrollIntoView(true);
                    }
                });
            }
        };
	
	// black magic http://stackoverflow.com/questions/805107/creating-multiline-strings-in-javascript/5571069#5571069
	function multiLines(f) {
		  return f.toString().replace(/^[^\/]+\/\*!?/, '').replace(/\*\/[^\/]+$/, '');
	}

	loadScript("coui://ui/main/shared/js/matchmaking_utility.js");
	
	ko.bindingHandlers.resizable = {
		    init: function(element, valueAccessor) {
		         var options = valueAccessor();
		         $(element).resizable(options);
		    }  
		};

	// had to copy this due to visibility reasons, mostly unmodified function
	/* an ubernet user you have encounterd: includes friends, recent contacts, ignored, blocked */
    function UserViewModel(id) {
        var self = this;
        //console.log('new UserViewModel');

        self.uberId = ko.observable(id);
        self.displayName = ko.observable(model.userDisplayNameMap()[id]);
        
        // modification: fix issues when a chat invite is sent from a contextmenu of a user in a chat.
        // in that case the invite will be started on that object, but the global "user" object in the idToContactMap will be used to answer following requests
        // due to the way "pendingChat" is tracked in the user this will result in an endless message loop between the clients
        // to prevent this, copy the value of pendingChat from this model over to the global one
        // a better fix would change the original definition of UserViewModel to remove assumptions about being singleton like global instances
        var u = model.idToContactMap()[self.uberId()];
        self.pendingChat = ko.observable(u && u.pendingChat());
        self.pendingChat.subscribe(function(v) {
        	var globalUserShadow = model.idToContactMap()[self.uberId()];
        	globalUserShadow.pendingChat(v);
        });
        // end of modifications
        
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

        self.hasName = ko.computed(function () { return self.displayName() &&  self.displayName() !== ''}); // added return, modified

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

        if (!self.hasName() && self.uberId()) // PA CHAT: fix as suggested by mikeyh
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
	
	var makeChatRoomUser = function(uberid, admin, mod, muted, league, rank, fullChannelName) {
		var obj = new UserViewModel(uberid);
		obj.isModerator = ko.observable(mod);
		obj.isAdmin = ko.observable(admin);
		obj.isMuted = ko.observable(muted);
		obj.league = ko.observable("unranked");
		obj.leagueImg = ko.computed(function() {
			return MatchmakingUtility.getSmallBadgeURL(obj.league());
		});
		
		obj.hasLeagueImage = ko.computed(function() {
			return obj.leagueImg() !== undefined && obj.leagueImg() !== "";
		});
		
		if (league) { 
			obj.league(league);
		}
		
		obj.rank = ko.observable(rank);
		obj.displayRank = ko.computed(function() {
			if (obj.rank()) {
				return "#"+obj.rank();
			} else {
				return undefined;
			}
		});
		
		obj.fullChannelName = ko.observable(fullChannelName);
		
        obj.displayNameComputed = ko.computed(function() {
        	var spl = obj.fullChannelName().split("/")[1];
        	return spl ? unescape(spl) : undefined;
        });
		
		return obj;
	};
	
	model.alignChatLeft = ko.observable().extend({ local: 'alignChatLeft' });
	
	var oldPresence = model.onPresence;
	model.onPresence = function(uid, pt, ps, grpChat, chatRoom, userinfo, stati, nameInChannel) {
		// this fixed my friendlist in one case, in many others it however screwed it over by adding "too many" friends.
		// sigh....
//		if (uid && !grpChat) { // a fix for cases of "my friendlist is empty"
//			var tagMap = model.userTagMap();
//			var tags = tagMap[uid] || {};
//			tags["FRIEND"] = true;
//			tagMap[uid] = tags;
//			model.userTagMap(tagMap)
//
//			for (var i = 0; i < model.users().length; i++) {
//				// trigger the computed friends() within the users. No idea why
//				// that does not work automatically,
//				// the hierarchy of the computes in this file is ... not easy to
//				// understand
//				model.users()[i].tags(model.users()[i].tags());
//			}
//		}
		
		if (grpChat) {
			var isAdmin = userinfo.affiliation === "owner";
			var isModerator = userinfo.role === "moderator" || userinfo.affiliation === "admin";
			var isMuted = userinfo.role === "visitor";
			if (uid !== model.uberId() || pt !== "unavailable") {
				var r = model.chatRoomMap()[chatRoom];
				if (!(r && r.usersMap()[nameInChannel])) {
					var userModel = makeChatRoomUser(uid, 
							isAdmin,
							isModerator,
							isMuted,
							userinfo.league,
							userinfo.rank,
							nameInChannel);
					model.insertUserIntoRoom(chatRoom, userModel);
				} else if (pt === "unavailable"){
					model.removeUserFromRoom(chatRoom, nameInChannel);
				} else if (r.usersMap()[nameInChannel]){
					r.usersMap()[nameInChannel].isModerator(isModerator);
					r.usersMap()[nameInChannel].isAdmin(isAdmin);
					r.usersMap()[nameInChannel].isMuted(isMuted);
				}
			} else {
				delete model.chatRoomMap()[chatRoom];
				model.chatRoomMap.notifySubscribers();
			}
		}
		if (!grpChat || uid !== model.uberId()) {
			oldPresence(uid, pt, ps);
		}
	};

	var oldMessage = model.onMessage;
	model.onMessage = function(uberid, message) {
		oldMessage(uberid, message);
	};
	
	var oldCommand = model.onCommand;
	model.onCommand = function(uberid, cmd) {
		oldCommand(uberid, cmd);
	};
	
	var notifyPlayer = function() {
		api.game.outOfGameNotification("");
		api.Panel.message("options_bar", "alertSocial");
	};
	
	model.onGrpChat = function(room, user, stati, content, timestamp) {
		if (content && user) {
			var r = model.chatRoomMap()[room];
			var userModel = undefined;
			if (r) {
				userModel = r.usersMap()[user];
			}
			if (!userModel) {
				userModel = makeChatRoomUser(undefined, false, false, false, undefined, undefined, user);
			}
			if (userModel.displayNameComputed() !== undefined) {
				model.insertMessageIntoRoom(room, {
					user: userModel,
					content: content,
					time: timestamp
				});
			}
			
			if (content.toLowerCase().indexOf(model.displayName().toLowerCase()) !== -1 && (new Date().getTime() - timestamp) < 10 * 1000) {
				notifyPlayer();
			}
		}
	};
	
	model.conversations.subscribe(function(c) {
		notifyPlayer();
		for (var i = 0; i < c.length; i++) {
			if (!c.alertSocialMarked) {
				c.alertSocialMarked = true;
				c[i].messageLog.subscribe(function() {
					notifyPlayer();
				});
			}
		}
	});
	
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
	
	model.myLeague = ko.observable();
	model.myRank = ko.observable();
	
	var initRank = function(cb) {
        engine.asyncCall('ubernet.getPlayerRating', 'Ladder1v1').done(function (data) {
        	try {
        		var d = JSON.parse(data);
        		model.myLeague(d.Rating)
        		model.myRank(d.LeaderboardPosition > 0 ? (d.LeaderboardPosition+"") : "Inactive");
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
	

	var setPresenceForUberbarVisibility = function(v) {
		if (jabber) {
			jabber.presenceType(v ? "available" : "dnd");
		}
	};
	
	var oldJabberAuth = handlers.jabber_authentication;
	handlers.jabber_authentication = function(payload) {
		oldJabberAuth(payload);
		jabber.setGrpMsgHandler(model.onGrpChat);
		jabber.setResultMsgHandler(model.onResultMsg);
		jabber.setErrorMsgHandler(model.onErrorMsg);
		jabber.setConnectHandler(function() {
			jabber.presenceType.subscribe(function(v) {
				for (var i = 0; i < model.chatRooms().length; i++) {
					jabber.setChannelPresence(model.chatRooms()[i].roomName(), v, model.myLeague(), model.myRank());
				}
			});
			initRank(function() {
				if (!decode(localStorage["info.nanodesu.pachat.disablechat"])) {
					model.joinChatRoom("halcyon");
				}
			});
		});
	};
	
	model.onErrorMsg = function(roomName, action, errorObj) {
		if (action.startsWith('showlisting_')) { //non standard handlers here
			getOrCreateRoom(roomName).writeSystemMessage('ERROR');
			getOrCreateRoom(roomName).writeSystemMessage('Error while ' + action);
			getOrCreateRoom(roomName).writeSystemMessage(errorObj.explanation);
		}
		else {
			getOrCreateRoom(roomName).writeSystemMessage('ERROR');
			getOrCreateRoom(roomName).writeSystemMessage('Error while ' + action + ' ' + (errorObj.user ? errorObj.user : (errorObj.uberId ? model.userDisplayNameMap()[errorObj.uberId] : 'noOne')));
			getOrCreateRoom(roomName).writeSystemMessage(errorObj.explanation);
		}
	};
	
	var resultCount;
	var resultType;
	var resultObj;
	var resultRoom;
	var resultAction;
	
	model.onResultMsg = function (roomName, action, resObj) {
		resultType = action;
		resultObj = resObj;
		resultRoom = roomName;
		
		self.resuObj = resultObj;
		
		if (action.startsWith("showlisting_")) {
			resultAction = action;
			resultCount = resultObj.length;

			for (var i = 0; i < resultObj.length; i++) {
				resultObj[i].userModel = new UserViewModel(resultObj[i].uberId);
				
				if (resultObj[i].userModel.hasName()) {
					resultCount--;
				} else {
					resultObj[i].userModel.hasName.subscribe(model.onResultDataReceived);
				}
			}			
			if (resultCount === 0) {
				model.onResultDataComplete();
			}
		} else {
			getOrCreateRoom(roomName).writeSystemMessage('SUCCESS');
			getOrCreateRoom(roomName).writeSystemMessage('Successfully ' + action + ' ' + (resObj.user ? resObj.user : (resObj.uberId ? model.userDisplayNameMap()[resObj.uberId] : 'noOne')) + (resObj.reason ? ' for ' + resObj.reason : ''));
		}
	};
	
	model.onResultDataReceived = function(data) {
		resultCount--;
		
		if (resultCount === 0) {
			model.onResultDataComplete();
		}
	};
	
	model.onResultDataComplete = function () {	
		var room = getOrCreateRoom(resultRoom);
		room.bannedUsers(resultObj);

		room.writeSystemMessage("Users for "+resultAction);
		for (var i = 0; i < resultObj.length; i++) {
			room.writeSystemMessage(resultObj[i].userModel.displayName() + ' : ' + (resultObj[i].reason ? resultObj[i].reason : 'no reason provided'));
		}
		room.writeSystemMessage("End of users");
	};
	
	function ChatRoomModel(roomName) {
		var self = this;
		
		self.bannedUsers = ko.observable([]);
		
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
		self.usersMap = ko.observable({}); // mapping fullChannelName > chat room UserViewModel
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
		
		self.usersCount = ko.computed(function() {
			return self.sortedUsers().length;
		});
		
		self.selfIsAdmin = function() {
			var r = false;
			_.forEach(self.usersMap(), function(u) {
				if (u.uberId() === model.uberId()) {
					r = u.isModerator() || u.isAdmin();
					return true;
				}
			});
			return r;
		};
		
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
			message.mentionsMe = message.content && message.content.toLowerCase().indexOf(model.displayName().toLowerCase()) !== -1 && model.uberId() !== message.user.uberId();
			self.messages.push(message);
			self.dirty(self.minimized());
			self.dirtyMention(self.minimized() && message.mentionsMe);
		};

		self.dirty = ko.observable(false);
		self.dirtyMention = ko.observable(false);
		self.dirty.subscribe(function(v) {
			if (!v) {
				self.dirtyMention(false);
			}
		});
		
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
		
		var commandList = ['/alignright', '/alignleft', '/ownerlist', '/adminlist', '/help', '/join', '/mute', '/unmute', '/kick', '/ban', '/banlist', '/unban', '/setrole', '/setaffiliation'].sort(function(a, b) {
			return b.length - a.length;
		});
		
		var cutStart = function(str, cut) {
			return str.slice(cut.length, str.length);
		};
		
		self.handleCommand = function(cmd) {
			var command = undefined;
			
			for (var i = 0; i < commandList.length; i++) {
				if (cmd.startsWith(commandList[i])) {
					command = commandList[i];
					break;
				}
			}
			
			var args = cutStart(cmd, command+" ").split(" ");
			for (var i = 0; i < args.length; i++) {
				console.log(args);
				if (args[i].endsWith("\\\\")) {
					args[i] = args[i].slice(0, args[i].length-1);
				} else if (args[i].endsWith("\\")) {
					var wSpace = args[i].slice(0, args[i].length-1)+ " ";
					args[i] = wSpace + args[i+1];
					args.splice(i+1, 1);
					i--;
				}
			}
			
			if (command === "/help") {
				 writeHelp(args);	
			} else if (command === "/alignleft") {
				model.alignChatLeft(true);
			} else if (command === "/alignright") {
				model.alignChatLeft(false);
			} else if (command === "/join") {
				model.joinChatRoom(args[0]);
//			} else if (command === "/announcelobby")) {
//				self.tryAnnounceLobby(args[0]);
			} else if (command === "/mute") {
				jabber.muteUser(self.roomName(), args[0], args[1]);
			} else if (command === "/unmute") {
				jabber.unmuteUser(self.roomName(), args[0], args[1]);
			} else if (command === "/kick") {
				jabber.kickUser(self.roomName(), args[0], args[1]);
			} else if (command === "/ban") {
				var user = self.sortedUsers().filter(function (elem) {return elem.displayName() === args[0];})[0];
				if (user) {
					jabber.banUser(self.roomName(), user.uberId(), args[1]);
				} else {
					self.writeSystemMessage('ERROR');
					self.writeSystemMessage('Error while banning ' + args[0]);
					self.writeSystemMessage(args[0] + ' has to be in the room!');
				}
			} else if (command === "/banlist") {
				jabber.showListing(self.roomName(), "outcast");
			} else if (command === "/adminlist") {
				jabber.showListing(self.roomName(), "admin");
			} else if (command === "/ownerlist") {
				jabber.showListing(self.roomName(), "owner");
			} else if (command === "/unban") {
				var user = self.bannedUsers().filter(function (elem) {return elem.userModel.displayName() === args[0];})[0];
				if (user && user.userModel) {
					jabber.unbanUser(self.roomName(), user.userModel.uberId(), args[1]);
				} else {
					self.writeSystemMessage('ERROR');
					self.writeSystemMessage('Error while unbanning ' + args[0]);
					self.writeSystemMessage(args[0] + ' is currently not in the list of banned users of this channel. Use /banlist to refresh the list.');
				}
			} else if (command === "/setrole") {
				jabber.setRole(self.roomName(), args[0], args[1]);
			} else if (command === "/setaffiliation") {
				var user = self.sortedUsers().filter(function (elem) {return elem.displayName() === args[0];})[0];
				if (user) {
					jabber.setAffiliation(self.roomName(), user.uberId(), args[1], args[2]);
				} else if (user = self.bannedUsers().filter(function (elem) {return elem.userModel.displayName() === args[0];})[0]) {
					jabber.setAffiliation(self.roomName(), user.userModel.uberId(), args[1], args[2]);
				} else {
					self.writeSystemMessage('ERROR');
					self.writeSystemMessage('Error while setting ' + args[0] + ' to ' + args[1]);
					self.writeSystemMessage(args[0] + ' seems to be neither on the banlist nor in the channel.');
				}
			} else {
				self.writeSystemMessage("unknown command: "+cmd);
			}
		};
		
		var writeHelp = function (args) {
			if (!args[0]) {
				self.writeSystemMessage("You can minimize PA, if somebody writes your name or private messages you, PA will blink.");
				self.writeSystemMessage("You can write a part of a name and press tab to autocomplete.");
				self.writeSystemMessage("Check out the modding forums PA Chat thread for more info on this chat.");
				self.writeSystemMessage("In general when entering commands you can escape spaces with \\ if you want to end a parameter in \, use \\ for the last backspace");
				self.writeSystemMessage("Admins are moderators by default, the moderator role is not persistent");
				self.writeSystemMessage("Try /help commands for a list of available commands, /help <command> for detailed info on one command.");
			} else if (args[0] === 'commands') {
				self.writeSystemMessage("Available commands are: " + commandList.join(', '));
			} else if (args[0] === 'join') {
				self.writeSystemMessage("/join <channelname> joins a chatchannel. If the channel does not exist it will be created.");
			} else if (args[0] === 'announcelobby') {
				self.writeSystemMessage("/announcelobby <msg> can be used to advertise a lobby you are currently in. Only works while in a public lobby.");
			} else if (args[0] === 'mute') {
				self.writeSystemMessage('/mute <user> [<reason>] mutes the given user in the current channel. This requires moderator privileges.');
			} else if (args[0] === 'unmute') {
				self.writeSystemMessage("/unmute <user> [<reason>] unmutes the given user in the current channel. This requires moderator privileges.");
			} else if (args[0] === 'ban') {
				self.writeSystemMessage("/ban <user> [<reason>] bans the given user from the current channel. This requires administrator privileges.");
			} else if (args[0] === 'banlist') {
				self.writeSystemMessage("/banlist prints the list of banned users of the current channel. This requires administrator privileges.");
			} else if (args[0] === 'unban') {
				self.writeSystemMessage("/unban <user> unbans the given user from the current channel. The user has to be on the list of banned users of the current channel (see /help banlist). This requires administrator privileges.");
			} else if (args[0] === 'setrole') {
				self.writeSystemMessage("/setrole <user> <role> [reason] sets the role of the given user in the current channel. This requires administrator or moderator privileges depending on what you want to do.");
				self.writeSystemMessage("Available roles are: visitor (moderator), participant (moderator), none (moderator), moderator (admin)");
			} else if (args[0] === 'setaffiliation') {
				self.writeSystemMessage("/setaffiliation <user> <affiliation> [reason] sets the affiliation of the given user in the current channel. This requires administrator or owner privileges depending on what you want to do.");
				self.writeSystemMessage("Available affiliations are: outcast (admin), none (admin), admin (owner),	owner (owner)");
			} else if (args[0] === "adminlist") {
				self.writeSystemMessage("/adminlist prints the list of admins of the current channel. This requires administrator privileges.");
			} else if (args[0] === "ownerlist") {
				self.writeSystemMessage("/ownerlist prints the list of owners of the current channel. This requires administrator privileges.");
			} else if (args[0] === "alignleft") {
				self.writeSystemMessage("/alignleft aligns the chatwindows to the left");
			} else if (args[0] === "alignright") {
				self.writeSystemMessage("/alignright aligns the chatwindows to the right");
			}
		};
		
		self.close = function() {
			model.leaveRoom(self.roomName());
		};
		
		self.writeSystemMessage = function(msg) {
			var fake = makeChatRoomUser(model.uberId(), false, false, false, undefined, undefined, "");
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
						if (user.displayNameComputed().toLowerCase().indexOf(lastWord.toLowerCase()) !== -1) {
							candidates.push(user.displayNameComputed());
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
			
			jabber.setChannelPresence(roomName, jabber.presenceType(), model.myLeague(), model.myRank());
			
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
		getOrCreateRoom(roomName).usersMap()[user.fullChannelName()] = user;
		getOrCreateRoom(roomName).usersMap.notifySubscribers();
	};
	
	model.removeUserFromRoom = function(roomName, nameInChannel) {
		delete getOrCreateRoom(roomName).usersMap()[nameInChannel];
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
			jabber.joinGroupChat(roomName, model.myLeague(), model.myRank(), model.displayName());
		}
	};
	
	model.leaveRoom = function(roomName) {
		var room = model.chatRoomMap()[roomName];
		if (room) {
			jabber.leaveGroupChat(room.roomName());
		}
	}
	
	model.chatRoomContext = function(data, event, roomModel) {
		if (event && data && data.uberId() !== model.uberId() && event.type === "contextmenu") { // knockout should do this for me, but somehow it does not?!
			model.contextRoom(roomModel);
			
			model.contextMenuForContact(data, event);
			
			$(document).bind("click.contexthackhandler", function() {
				setTimeout(function() {
					model.contextRoom(undefined);
				}, 50);
				$(document).unbind("click.contexthackhandler");
			});
			
			$('#contextMenu a[data-bind="click: remove"]').parent().remove(); // "remove" has no purpose in the chatroom
			var ctxMenu = $('#contextMenu');
			var bottomMissingSpace = ctxMenu.offset().top - $(window).height() + ctxMenu.height()
			if (bottomMissingSpace > 0) {
				ctxMenu.css("top", ctxMenu.position().top - bottomMissingSpace);
			}
		}
	};
	
	model.showUberBar.subscribe(setPresenceForUberbarVisibility);
	setPresenceForUberbarVisibility(model.showUberBar());
	
	model.contextRoom = ko.observable(undefined);
	model.contextRoomSelected = ko.computed(function() {
		return model.contextRoom() !== undefined;
	});
	
	model.showUberBar.subscribe(function() {
		for (var i = 0; i < model.chatRooms().length; i++) {
			model.chatRooms()[i].scrollDown();
		}
	});
	
	model.joinChannelName = ko.observable('');
	
	model.selectedContactIsMuted = ko.computed(function() {
		return model.selectedContact() && model.selectedContact().isMuted && model.selectedContact().isMuted();
	});
	
	var extendedContextMenuHtml = multiLines(function() {/*!
		
		<!-- ko if: model.contextRoomSelected() && model.contextRoom().selfIsAdmin() && !model.selectedContactIsMuted()-->
                        <li><a data-bind="click: function() {jabber.muteUser(model.contextRoom().roomName(), displayNameComputed())}" tabindex="-1" href="#"><span class="menu-action">
                            Mute
                        </span></a></li>
                        <!-- /ko -->

						<!-- ko if: model.contextRoomSelected() && model.contextRoom().selfIsAdmin() && model.selectedContactIsMuted()-->
                        <li><a data-bind="click: function() {jabber.unmuteUser(model.contextRoom().roomName(), displayNameComputed())}"  tabindex="-1" href="#"><span class="menu-action">
                            Unmute
                        </span></a></li>
                        <!-- /ko -->

						<!-- ko if: model.contextRoomSelected() && model.contextRoom().selfIsAdmin() -->
                        <li><a data-bind="click: function() {jabber.kickUser(model.contextRoom().roomName(), displayNameComputed())}" tabindex="-1" href="#"><span class="menu-action">
                            Kick
                        </span></a></li>
                        <!-- /ko -->
		
	*/});
	
	
	$('#contextMenu > .dropdown-menu').append(extendedContextMenuHtml);
	
	
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
                    <div class="div-chat-room-window" data-bind="resizable: {minWidth: 300, handles : 'w, e', resize: function(event,ui) {$('.div-chat-room-window').css('left', 0); scrollDown();}}">
                        <div data-bind="css: { 'div-chat-header': !dirtyMention(), 'dirty': dirty() && !dirtyMention(), 'dirtyMention': dirtyMention() }, click: toggleMinimized">
                            <div class="div-chat-room-title">
								<!-- ko ifnot: minimized -->
								<div class="div-chat-room-name ellipsesoverflow" data-bind="text: roomName()+'('+usersCount()+') - chat provided by PA Stats. Try /help'"></div>
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
	                                <!-- ko if: !user.blocked() || user.isAdmin() || user.isModerator() -->
	                                <div class="chat_message" data-bind="css: {'markedline': mentionsMe}">
										<span class="chat_message_time" data-bind="text: new Date(time).toLocaleTimeString()"></span>
	                                    <span data-bind="text: user.displayNameComputed(), event: {contextmenu: model.chatRoomContext(user, event, $parent)},
										css: {'chat-room-user-name': !user.isModerator() && !user.isAdmin(),
																'chat-room-moderator-name': user.isModerator() && !user.isAdmin(),
																'chat-room-admin-name': user.isAdmin(),
																'chat-room-muted-name': user.isMuted(),
																'chat-room-self-name': model.uberId() === user.uberId()}"></span>:
	                                    <span class="chat-msg selectable-text" data-bind="text: content"></span>
	                                </div>
	                                <!-- /ko -->
                                <!-- /ko -->
                                <div data-bind="autoscroll: sortedMessages"></div>
                            </div>
							<div class="div-chat-room-users ">
								<!-- ko foreach: sortedUsers -->
								<div class="chat_user ellipsesoverflow" data-bind="event: {contextmenu: model.chatRoomContext($data, event, $parent)}">
									<div class="status-visual" data-bind="css: { 'online': available, 'offline': offline, 'away': away, 'dnd': dnd }"></div>
									<!-- ko if: hasLeagueImage -->
									<img data-placement="right" width="24px" height="20px" data-bind="attr: {src: leagueImg()}, tooltip: displayRank()" />
									<!-- /ko -->
									<span class="selectable-text" data-bind="css: {'chat-room-user-name': !isModerator() && !isAdmin(),
															'chat-room-moderator-name': isModerator() && !isAdmin(),
															'chat-room-admin-name': isAdmin(),
															'chat-room-muted-name': isMuted(),
															'chat-room-blocked-name': blocked() && !isAdmin() && !isModerator()}, text: displayNameComputed"></span>
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
	
	$('.div-social-canvas > .chat-wrapper').attr("data-bind", "style: {'justify-content': model.alignChatLeft() ? 'flex-start' : 'flex-end'}");
	
	
	
	// fix a bug that causes "chat" option be displayed while it should not be displayed:
	$('#contextMenu > .dropdown-menu').children().first().remove();
	$('#contextMenu > .dropdown-menu').prepend(multiLines(function() {/*!
        <!-- ko if: (friend() && online()) -->
        <li><a data-bind="click: startChat" tabindex="-1" href="#"><span class="menu-action">
            <loc data-i18n="uberbar:chat.message" desc="">Chat</loc>
        </span></a></li>
        <!-- /ko -->
	*/}));
	
	
}());

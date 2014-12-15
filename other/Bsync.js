// BSync: Sync support class for Chrome Extensions
// V 1.0 by George E. Papadakis, phaistonian@gmail.com
Extensions = {
	getExtension : function(callback) {
		var url = 'manifest.json';
		var xhr= new XMLHttpRequest();
		xhr.open('GET', url, true);
		xhr.send();

		xhr.onreadystatechange = function() {
			if (xhr.readyState == 4 ) {
				callback && callback(JSON.parse(xhr.responseText));
			}
		};
	}
}

BSync = function(options) {
	this.initialize(options);
	return this;
};
BSync.prototype = {
	'options'	: {
		'debug'				: false,

		'interval'			: (450 +  Math.floor(Math.random() * 25) ) * 1000,					// 5 mins +
		'newLine'			: '\n', 															// char code to replace
		'idleInterval'		: 200 * 1000,
		'name'				: null,																// Auto fills with the extension's name
		'deleteOther'		: true,																// Delete ones with the same name
		'parent'			: null,																// Auto fills with the other.bookmarks

		'testNetwork'		: false,																// MAKE SURE google.com is on premissions list
		'networkTimeout' 	: 3000,																// 3 secs

		'folder'			: 'BSync',															// Must have

		// Error handler
		'onError'		: function(msg) {
			//TODO: Handle msg
			console.log('BSYNC ERROR : ' + msg);
			this.options && this.options.debug && console.log('ERROR: ' + msg)
		}
	},

	'initialize' : function(options) {
		var self = this;
		this.setOptions(options);

		if(this.options.debug) {
			//this.options.interval 		= 10 * 1000;
			//this.options.idleInterval 	= 5 * 1000;
		}

		// Get parent options.parent >> the latest folder in 0 level
		// Used to have this as 2, but that's wrong.
		if(!this.options.parent) {
			chrome.bookmarks.getChildren('0', function(tree) {
				tree.forEach(function(item, index) {
					self.options.parent = item.id;
				});
			});
		}

		return this;
	},

	attach: function() {
		var self = this;
		if(this.isAttached) {
			return this;
		}

		// Get the name and come back
		if(!this.options.name) {
			Extensions.getExtension(function(json) {
				self.options.name = json.name;
				self.attach();
			});
			return this;
		}
		this.isAttached = true;

		// No name, no game
		if(!this.options.name || !this.options.folder) {
			throw('No name (name or folder) given, bailing out');
			return;
		}

		// Must not be less < 2 mins
		if(!this.options.debug && parseInt(this.options.interval) < 120 * 1000) {
			this.options.interval = 120 * 1000;
		}

		// First traverse = wait 10 secs.
		// TODO: Figure out a way to make this better.
		setTimeout((function() {
			self.traverse();
		}), 10000);

		// Global bookmark event handler
		// Needed to instant check on a bookmark
		chrome.bookmarks.onCreated.addListener(function(id, bookmark) {
			var ts;
			if(bookmark.url && self.folder && self.folder.id == bookmark.parentId && (ts = self.isValidBookmark(bookmark) )) {
				(function() {
					// Checkin on timestamps is safer - it seems
					// since self.bookmark is defined later on.
					if(self.bookmark && (parseInt(self.syncedAt) != parseInt(ts) ) && (self.bookmark.id !== bookmark.id)  	) {
						// Stop timers
						self.stop();
						self.options.debug && console.log('REMOVING AND PROCEESSING ON CREATED');

						// Assign the syncedAt to the bookmark.
						// Will be needed later when processing (if it shouldRead() )
						// NOTE: useless since isValidBookmark does that already
						bookmark.syncedAt = ts;

						self.process(bookmark, true);

						// Start timers
						self.start();
					} else  {
						return false;
					}
				}).delay(800, this);
			}

		});

		// Used to check for folder removal (sanity)
		chrome.bookmarks.onRemoved.addListener(function(id, bookmark) {
			self.options.debug && bookmark.url == undefined && console.log('onRemoved self.folder.id:' + self.folder.id +', id: ' + id + ' title:' + bookmark.title);

			// In case the folder is the same as self.folder then nullify
			// the folder in order to re-get it.
			if(self.folder && (id == self.folder.id) ) {
				self.folder = null;
			}
		});

		return this;

	},

	testNetwork: function() {
		var xhr = new XMLHttpRequest(), self = this;
		var timer 	 = setTimeout( function() {
			self.error('NO_NETWORK')
			return this;
		}, this.options.networkTimeout);

		xhr.open('GET', 'http://www.google.com/favicon.ico', true);
		xhr.send();

		xhr.onreadystatechange = function() {
			if (xhr.readyState == 4 ) {s
				clearTimeout(timer);
				timer = null;

				// Proper response = traverse
				if(xhr.responseText.length > 100 ) {
					self.traverse(true);
				}
			}
		};

		return this;
	},

	getFolder: function() {
		var self = this;
		if(this.folder) {
			return this.folder;
		};

		var folder, toMove = [], toDelete = [];

		// Find the folder
		chrome.bookmarks.getChildren(this.options.parent.toString(), function(tree) {
			var ts = 0;
			tree.forEach(function(item, index) {
				// Move previous items to the folder;
				if( item.title.match( new RegExp('^.+?\\\.' + '([0-9]{10,}?)$'))) {
					toMove.push(item);
				}

				if(item.title === self.options.folder && item.url === undefined) {
					// Keep the one with the hightest dateAdded
					if(item.dateAdded > ts) {
						folder= item;
						ts 		= item.dateAdded;
					}
					toDelete.push(item);
					return this;
				}
			});


			if(!folder) {
				folder = chrome.bookmarks.create({
					'parentId'  : self.options.parent.toString(), // other
					'title'		: self.options.folder
				});
			} else {
				// Remove unwanted (more than one) folders with the same name.
				toDelete.forEach(function(f, index) {
					if(f.id !== folder.id) {
						chrome.bookmarks.removeTree(f.id);
					}
				});
			}


			// Move OLD way items to folder
			if(folder && toMove) {
				toMove.forEach(function(item, index) {
					chrome.bookmarks.move(item.id, {
						'parentId' : folder.id.toString()
					});
				});
			}

			self.folder  = folder;

			// Traverse again
			self.traverse(true);
		});

		return false;
	},

	traverse: function(skipTest) {
		var self 	= this, toDelete = [], bookmark, content, folder = this.folder, match;

		// Make sure !this.folder is present below
		if(!skipTest && this.options.testNetwork && !this.folder) {
			return this.testNetwork();
		}

		if(this.lastTraversed) {
			this.options.debug && console.log( 'TRAVERSED DIFF : ' + ((new Date().getTime() - this.lastTraversed ) / 1000 ) );
			this.lastTraversed = new Date().getTime();
		} else {
			this.lastTraversed = new Date().getTime();
		}


		// If the update is less than 1 minute < wait for it to be idle then come back
		// THIS IS HUGE TIME SAVER (avoids multiple stuff)
		// NOTE: First time is a go (this.syncedAt is undefiend )
		if(this.options.getUpdate && this.options.getUpdate() && this.syncedAt) {
			if( (new Date().getTime() - this.options.getUpdate() )  < this.options.idleInterval ) {
				console.log('WAITING FOR '+this.idleInterval+'  TO GET UN-IDLE')

				// Not idle  // Wait for twice the idleInterval
				// TODO: Make sure this is done right.
				setTimeout( (function() {
					self.traverse();
				}), this.options.idleInterval * 2);

				return this;
			}
		}


		// No folder yet - go fetch one
		// .getFolder will bring us here again.
		if(!folder) {
			return this.getFolder();
		}

		chrome.bookmarks.getChildren(folder.id.toString(), function(tree) {
			var syncedAt = 0, ts;
			tree.forEach(function(item, index) {
				// valid bookmark
				if(ts  = self.isValidBookmark(item)) {
					if(self.options.deleteOther) {
						toDelete.push(item);
					}

					// Make sure this bookmark is a bit valid.
					// We want the one with the latest syncedAt value and one with a void.
					if(item.url.indexOf('void') != -1 && ( ts > syncedAt )) {
						bookmark= item;

						// NOTE: This is useless (too) sinc isValidBookmark does it already.
						bookmark.syncedAt= ts; // timestamp
						syncedAt 			= ts;
					}
				}

			});

			// No bookmark founds
			if(!bookmark) {
				self.options.debug && console.log('NO BOOKMARK FOUND  > WRITING');
				self.options.onWrite();
				return self.options.onError('MISSING BOOKMARK');
			}

			// Delete other bookmarks:
			// Prolly left here by quota issues.
			if(self.options.deleteOther) {
				toDelete.forEach(function(b, i) {
					if(String(b.id) != String(bookmark.id)) {
						try {
							chrome.bookmarks.remove(String(b.id));
						} catch(ex) {}
					}
				});
			}

			// Register this.previousSync for first timec
			self.synced = bookmark.syncedAt;

			// TODO: Is this really needed here?
			self.bookmark = self.bookmark || bookmark;

			return self.process(bookmark);

		});

		// Re-roll
		return this.start();
	},

	// Process the actual bookmark and do what's needed  + cast events
	// forceRead means that the function is called durin a onCreated event
	process: function(bookmark, forceRead) {
		var content, self = this;

		// Get the content
		if(!(content = this.getJSON(bookmark) ) ) {
			self.options.debug && console.log(' NO CONTENT FOUND > WRITING' );
			this.options.onWrite()
			return this.options.onError('NO CONTENT');
		}

		// Assign data to self
		this.content 		= content;

		// Must
		var syncedPrevious= this.syncedAt;


		this.syncedAt= bookmark.syncedAt;

		// We need to read
		if(0) {
			if(this.shouldRead()) {
				this.syncedAtPrevious= syncedPrevious;
				this.markTimestamp();
				this.bookmark = bookmark;
				this.options.onRead(content, bookmark);
			}  else if(this.shouldWrite() ) {
				this.options.onWrite(content, bookmark);
			} else {
				self.options.debug && console.log(' NOTHING TO DO :) ');
			}
		} else {





			if(!forceRead && this.shouldWrite()) {
				self.options.debug &&  console.log('\nAbout to write');
				this.options.onWrite(content, bookmark);
			}  else if(this.shouldRead() ) {
				self.options.debug &&  console.log('\nAbout to read');
				this.syncedAtPrevious= this.syncedAt;
				this.markTimestamp();
				this.bookmark 			= bookmark;
				this.options.onRead(content, bookmark);
			} else {
				self.options.debug &&  console.log(' NOTHING TO DO :) ');
			}


		}


		return this;
	},

	shouldRead: function() {
		// NOTE: if we dont have a syncedPrevious and options.getupdate, try a time in past
		if(this.options.debug) {
			console.log('\n\nChecking shouldRead()');
			console.log('this.syncedAtPrevious: ' + this.syncedAtPrevious);
			console.log('this.syncedAt: ' + this.syncedAt);
			console.log('his.options.getUpdate(): ' + this.options.getUpdate());
		}

		return this.options.getUpdate() === undefined || ( this.content && this.syncedAt > this.options.getUpdate());
	},

	shouldWrite: function() {
		if(this.options.debug) {
			console.log('\n\nChecking shouldWrite()');
			console.log('this.syncedAtPrevious: ' + this.syncedAtPrevious);
			console.log('this.syncedAt: ' + this.syncedAt);
			console.log('his.options.getUpdate(); ' + this.options.getUpdate());
		}


		return !this.content || ( this.options.getUpdate() && (  this.options.getUpdate() > this.syncedAt  ));
	},

	// Please be aware that content size can not exceed 2.2k
	write: function(json) {
		var self = this;
		// Same content / Error / bail out
		// http://groups.google.com/group/chromium-extensions/msg/e6fc1923ba706f11
		if(this.content) {
			if( JSON.stringify(this.content) === JSON.stringify(json) ) {
				self.options.debug && console.log('SORRY SAME CONTENT / BAILING OUT');
				return false;
			}
		}

		// TODO: In the future, we could just update this.
		// WAIT FOR 1 (+1 sec) min before - to avoid throttling
		if(this.bookmark && this.bookmark.id) {
			try { chrome.bookmarks.remove(String(this.bookmark.id)); } catch(ex) { }
		}


		this.syncedAtPrevious= this.syncedAt;

		// THIS IS THE KEY!
		this.syncedAt 			= this.options.getUpdate() || new Date().getTime();

		// TODO: Do it recursively, not just for the first level
		// Fixes the new line issue for the url
		var fixNL = function(obj) {
			each(obj, function(value, key) {
				if(value && value.toLowerCase && value.toLowerCase()) {
					obj[key] == value.replace( new RegExp('('+ String.fromCharCode(10) + '|' + String.fromCharCode(13) +')' , 'g'),self.options.newLine);
				}
			});
			return obj;
		}
		json = fixNL(json);

		// Make the bookmark, and assign it to self
		chrome.bookmarks.create({
			'parentId'  : this.folder.id.toString(), // other
			'title'		: this.options.name + '.' + this.syncedAt, // append the timestamp / 1000 (unixtimestamp)
			'url'		: 'javascript:void(\''+ JSON.stringify(json) + '\');void('+(Math.random() * 1000)+');'
			},
			function(bookmark) {
				// Assign bookmark to self
				self.bookmark = bookmark;
			}
		);

		self.options.debug && console.log('\nWROTE > ' + JSON.stringify(json) )

		this.markTimestamp(true);

		return this;
	},

	start: function() {
		if(!this.isAttached) {
			return this.attach();
		}
		var self 		= this;
		this.timer 		= setTimeout(function() { self.traverse(); }, this.options.interval);
		this.isRunning 	= true;

		return this;
	},

	stop: function() {
		if(!this.isRunning) {
			return this;
		}

		clearTimeout(this.timer);
		this.timer = null;
		this.isRunning = false;
		return this;
	},

	setOptions: function(options) {
		var self = this, fn, bound;
		for(var i in options) {

			if(typeof(options[i]) == 'function') {
				this.options[i] = function() {
					return options[i].apply(self, Array.prototype.slice.call(arguments));
					//options[i].bind(this);
				}
			} else {
				this.options[i] = options[i];
			}
		}

		return this;
	},

	// Register timestamps
	markTimestamp: function(mode) {
		this['synced' + (mode ? 'To' : 'From')] = new Date().getTime();
		return this;
	},

	// Parses a bookmark's.url content as JSON
	getJSON: function(bookmark) {
		var source= bookmark.url, content, json = '';
		source 			= source.replace(/^.*?void\('(.*?)'\);void.*?$/, '$1');

		source= source.replace( new RegExp( this.options.newLine, 'g'), String.fromCharCode(10));

		if(source) {
			try {
				json = JSON.parse(source);
			} catch(ex) {
				json = '';
			}
		}

		return json;
	},


	// Returns the timestamp of bookmark based on its title
	// or null if false;
	isValidBookmark  : function(bookmark) {
		var match;

		if(!bookmark) {
			return false;
		}

		if(!(match  = bookmark.title.match( new RegExp('^'+ this.options.name + '\\\.' + '([0-9]{10,}?)$')))) {
			return false;
		}

		// VERY CRITICAL
		bookmark.syncedAt = match[1];

		// Timestamp
		return parseInt(match[1]);
	}
}
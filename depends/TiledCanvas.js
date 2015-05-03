function TiledCanvas (canvas, settings) {
    this.canvas = canvas;
    this.ctx = this.canvas.getContext('2d');

    this.leftTopX = 0;
    this.leftTopY = 0;
    this.zoom = 1; // 2 = two times zoomed in

    this.affecting = [[0, 0], [0, 0]];
    this.chunks = {};

    this.settings = this.normalizeDefaults(settings, this.defaultSettings);
    this.contextQueue = [];
    this.context = this.createContext();
}

TiledCanvas.prototype.defaultSettings = {
    chunkSize: 256
};

TiledCanvas.prototype.cloneObject = function (obj) {
	var clone = {};
	for (var k in obj) {
		if (typeof obj[k] === "object" && !(obj[k] instanceof Array)) {
			clone[k] = this.cloneObject(obj[k]);
		} else {
			clone[k] = obj[k]
		}
	}
	return clone;
};

TiledCanvas.prototype.normalizeDefaults = function normalizeDefaults (target, defaults) {
	target = target || {};
	var normalized = this.cloneObject(target);
	for (var k in defaults) {
		if (typeof defaults[k] === "object" && !(defaults[k] instanceof Array)) {
			normalized[k] = this.normalizeDefaults(target[k] || {}, defaults[k]);
		} else {
			normalized[k] = target[k] || defaults[k];
		}
	}
	return normalized;
};


TiledCanvas.prototype.redraw = function redraw (noclear) {
    if (!noclear) this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

    var startChunkX = Math.floor(this.leftTopX / this.settings.chunkSize),
        endChunkX   = Math.ceil((this.leftTopX + this.canvas.width / this.zoom) / this.settings.chunkSize),
        startChunkY = Math.floor(this.leftTopY / this.settings.chunkSize),
        endChunkY   = Math.ceil((this.leftTopY + this.canvas.height / this.zoom) / this.settings.chunkSize);
    
    for (var chunkX = startChunkX; chunkX < endChunkX; chunkX++) {
        for (var chunkY = startChunkY; chunkY < endChunkY; chunkY++) {
            this.drawChunk(chunkX, chunkY);
        }
    }
};

TiledCanvas.prototype.drawChunk = function drawChunk (chunkX, chunkY) {
    if (this.chunks[chunkX] && this.chunks[chunkX][chunkY]) {
        this.ctx.drawImage(this.chunks[chunkX][chunkY].canvas, ((chunkX * this.settings.chunkSize) - this.leftTopX) * this.zoom, ((chunkY * this.settings.chunkSize) - this.leftTopY) * this.zoom, this.settings.chunkSize * this.zoom, this.settings.chunkSize * this.zoom);
    } else if(typeof this.requestUserChunk == "function") {
        this.requestChunk(chunkX, chunkY);
    }
};

TiledCanvas.prototype.goto = function goto (x, y) {
    this.leftTopX = x;
    this.leftTopY = y;
    this.redraw();
};

TiledCanvas.prototype.relativeZoom = function relativeZoom (zoom) {
    this.zoom *= zoom;
    this.redraw();
};

TiledCanvas.prototype.absoluteZoom = function absoluteZoom (zoom) {
    this.zoom = zoom;
    this.redraw();
};

TiledCanvas.prototype.execute = function execute () {
    this.executeNoRedraw();
    this.redraw();
};

TiledCanvas.prototype.executeNoRedraw = function executeNoRedraw () {
    for (var chunkX = this.affecting[0][0]; chunkX < this.affecting[1][0]; chunkX++) {
        for (var chunkY = this.affecting[0][1]; chunkY < this.affecting[1][1]; chunkY++) {
            this.executeChunk(chunkX, chunkY);
        }
    }
    this.contextQueue = [];
};

TiledCanvas.prototype.clearAll = function clearAll () {
    this.contextQueue = [];
    for (var chunkX in this.chunks) {
        this.clearChunkRow(chunkX);
    }
};

TiledCanvas.prototype.clearChunkRow = function clearChunkRow (chunkX) {
    for (var chunkY in this.chunks[chunkX]) {
        this.clearChunk(chunkX, chunkY);
    }
};

TiledCanvas.prototype.clearChunk = function clearChunk (chunkX, chunkY) {
	this.chunks[chunkX][chunkY].clearRect(chunkX * this.settings.chunkSize, chunkY * this.settings.chunkSize, this.chunks[chunkX][chunkY].canvas.width, this.chunks[chunkX][chunkY].canvas.height);
};

TiledCanvas.prototype.requestChunk = function requestChunk (chunkX, chunkY, callback) {
    // Request a chunk and redraw once we got it
    if (typeof this.requestUserChunk !== "function") return;
    callback = callback || function () {};
    this.requestChunkCallbackList = this.requestChunkCallbackList || {};

    if (this.requestChunkCallbackList[chunkX] && this.requestChunkCallbackList[chunkX][chunkY]) {
        // This chunk has already been requested, add to the callback list
        this.requestChunkCallbackList[chunkX][chunkY].push(callback);
    } else {
        // Create a callback list for this chunk
        this.requestChunkCallbackList[chunkX] = this.requestChunkCallbackList[chunkX] || {};
        this.requestChunkCallbackList[chunkX][chunkY] = [callback];

        this.requestUserChunk(chunkX, chunkY, function (image) {
            // Draw the chunk
            this.chunks[chunkX][chunkY] =  this.newCtx(this.settings.chunkSize, this.settings.chunkSize, -chunkX * this.settings.chunkSize, -chunkY * this.settings.chunkSize);
            this.chunks[chunkX][chunkY].drawImage(image, 0, 0);

            // Run all callbacks
            var callbackList = this.requestChunkCallbackList[chunkX][chunkY];
            for (var k = 0; k < callbackList.length; k++) {
                callbackList[k]();
            }

            // Do a full redraw of the tiled canvas
            this.redraw();

            delete this.requestChunkCallbackList[chunkX][chunkY];
        }.bind(this));
    }
};

TiledCanvas.prototype.executeChunk = function executeChunk (chunkX, chunkY, queue) {
    // Executes the current queue on a chunk
    // If queue is set execute that queue instead
    this.chunks[chunkX] = this.chunks[chunkX] || [];
    this.chunks[chunkX][chunkY] = this.chunks[chunkX][chunkY];
 
    if (!this.chunks[chunkX][chunkY]) {
        // This chunk has never been painted to before
        // We first have to ask what this chunk looks like
        // Remember the Queue untill we got the chunk
        // if we already remembered a queue then add this queue to it
        // Only do this when we actually want to use userdefined chunks
        if (typeof this.requestUserChunk == "function") {
            this.requestChunk(chunkX, chunkY, function (queue) {
                this.executeChunk(chunkX, chunkY, queue);
            }.bind(this, this.copyArray(queue || this.contextQueue)))
            return;
        } else {
            this.chunks[chunkX][chunkY] =  this.newCtx(this.settings.chunkSize, this.settings.chunkSize, -chunkX * this.settings.chunkSize, -chunkY * this.settings.chunkSize);
        }
    }

    var ctx = this.chunks[chunkX][chunkY];

    for (var queuekey = 0; queuekey < this.contextQueue.length; queuekey++) {
        if (typeof ctx[this.contextQueue[queuekey][0]] === 'function') {
            this.executeQueueOnChunk(ctx, this.contextQueue[queuekey]);
        } else {
            ctx[this.contextQueue[queuekey][0]] = this.contextQueue[queuekey][1];
        }
    }
};

TiledCanvas.prototype.executeQueueOnChunk = function executeQueueOnChunk (ctx, args) {
    ctx[args[0]].apply(ctx, Array.prototype.slice.call(args, 1));
};

TiledCanvas.prototype.drawingRegion = function (startX, startY, endX, endY, border) {
    border = border || 0;
    this.affecting[0][0] = Math.floor((Math.min(startX, endX) - border) / this.settings.chunkSize);
    this.affecting[0][1] = Math.floor((Math.min(startY, endY) - border) / this.settings.chunkSize);
    this.affecting[1][0] = Math.ceil((Math.max(endX, startX) + border) / this.settings.chunkSize);
    this.affecting[1][1] = Math.ceil((Math.max(endY, startY) + border) / this.settings.chunkSize);
};

TiledCanvas.prototype.newCtx = function newCtx (width, height, translateX, translateY) {
    var ctx = document.createElement('canvas').getContext('2d');
    ctx.canvas.width = width;
    ctx.canvas.height = height;
    ctx.translate(translateX, translateY);
    return ctx;
};

TiledCanvas.prototype.createContext = function createContext () {
    var context = {};
    var ctx = document.createElement('canvas').getContext('2d');
    for (var key in ctx) {
        if (typeof ctx[key] === 'function') {
            context[key] = function (func) {
                this.contextQueue.push(arguments);
            }.bind(this, key);
        } else if (typeof ctx[key] !== 'object') {
            context.__defineGetter__(key, function (key) {
                var ctx = this.newCtx();
                for (var queuekey = 0; queuekey < this.contextQueue.length; queuekey++) {
                    if (typeof ctx[args[0]] === 'function') {
                        ctx[args[0]].apply(ctx, args.slice(1));
                    } else {
                        ctx[args[0]] = args[1];
                    }
                }
                return ctx[key];
            }.bind(this, key));

            context.__defineSetter__(key, function (key, value) {
                this.contextQueue.push(arguments);
            }.bind(this, key));
        }
    }
    return context;
};

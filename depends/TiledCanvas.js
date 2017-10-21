function TiledCanvas (canvas, settings) {
    this.canvas = canvas;
    this.ctx = this.canvas.getContext('2d');

    this.leftTopX = 0;
    this.leftTopY = 0;
    this.zoom = 1; // 2 = two times zoomed in

    this.affecting = [[0, 0], [0, 0]];
    this.chunks = {};
    // this.chunks[chunkX][chunkY] is a context or 'empty'

    this.settings = this.normalizeDefaults(settings, this.defaultSettings);
    this.contextQueue = [];
    this.context = this.createContext();
    this.lastClear = Date.now();
}

TiledCanvas.prototype.MIN_INACTIVE_UNLOAD_TIME = 10 * 1000;
TiledCanvas.prototype.MAX_DRAW_TIME = 1000 / 30;

TiledCanvas.prototype.defaultSettings = {
    chunkSize: 1024,                      // The size of the chunks in pixels
    fadeTime: 500,                       // Fade time for the loading animation
    maxLoadedChunks: 100,                 // We'll try never loading more than this amount of chunks if possible
	blurOnZoom: true,
	zoomLevelToPixelate: 5
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

// Function that schedules one redraw, if you call this twice
// within the same frame, or twice before a redraw is done, only one redraw
// will actually be executed
TiledCanvas.prototype.redrawOnce = function redrawOnce () {
    if (!this._redrawTimeout)
        this._redrawTimeout = requestAnimationFrame(this.redraw.bind(this, false));
};

// Forces a full redraw now, might be paused halfway if it takes too long
// Cancels queued breakdraws
// You should probably not call this function yourself, use redrawOnce
TiledCanvas.prototype.redraw = function redraw () {
	cancelAnimationFrame(this._redrawTimeout);
	delete this._redrawTimeout;
	
	// If we are still drawing the last frame, wait for it to finish
	if (this.breakDrawing || this.breakDrawingRequest) {
		this.redrawOnce();
		return;
	}

	this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

	this.ctx.save();
	this.ctx.setTransform(1, 0, 0, 1, 0, 0);
	this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
	this.ctx.restore();
	
    var startChunkX = Math.floor(this.leftTopX / this.settings.chunkSize),
        endChunkX   = Math.ceil((this.leftTopX + this.canvas.width / this.zoom) / this.settings.chunkSize),
        startChunkY = Math.floor(this.leftTopY / this.settings.chunkSize),
        endChunkY   = Math.ceil((this.leftTopY + this.canvas.height / this.zoom) / this.settings.chunkSize);

	this.breakDraw(startChunkX, startChunkY, startChunkY, endChunkX, endChunkY);
};


/*
	If a redraw takes too long the user will be left with an unresponsive application.
	To remedy this we have to return control back to the js interpreter
	
	We will save the last chunkX and chunkY. We have to block all new redrawOnce untill we are done though.
	We also have to remember our original leftTopX and leftTopY and zoom
	If they changed, we abort and just draw again.
	
	This function will make sure next frame we continue and remember all the right params
*/
TiledCanvas.prototype.breakDrawInit = function breakDrawInit (chunkX, chunkY, startChunkY, endChunkX, endChunkY) {
	// This shouldn't happen, but if it does, abort everything and just redraw
	// This can only happen if we are drawing twice in the same frame
	if (this.breakDrawingRequest) {
		console.error("BreakDrawInit called while there is already a breakdraw request. Full redraw in the next frame scheduled.");
		this.breakDrawing = false;
		cancelAnimationFrame(this.breakDrawingRequest);
		delete this.breakDrawingRequest;
		this.redrawOnce();
		return;
	}
	
	this.breakDrawing = true;
	this.breakDrawingLeftTopX = this.leftTopX;
	this.breakDrawingLeftTopY = this.leftTopY;
	this.breakDrawingZoom = this.zoom;
	this.breakDrawingRequest = requestAnimationFrame(this.breakDraw.bind(this, chunkX, chunkY, startChunkY, endChunkX, endChunkY));
};


TiledCanvas.prototype.breakDraw = function breakDraw (chunkX, chunkY, startChunkY, endChunkX, endChunkY) {
	cancelAnimationFrame(this.breakDrawingRequest);
	delete this.breakDrawingRequest;

	// If we are breakdrawing already, and our params mismacht, abort and just redraw
	if (this.breakDrawing && (
			this.leftTopX !== this.breakDrawingLeftTopX ||
			this.leftTopY !== this.breakDrawingLeftTopY ||
			this.zoom !== this.breakDrawingZoom
		)) {
		this.breakDrawing = false;
		cancelAnimationFrame(this.breakDrawingRequest);
		delete this.breakDrawingRequest;
		this.redrawOnce();
		return;
	}
		
	var start = Date.now();
	for (; chunkX < endChunkX; chunkX++) {
        for (chunkY = startChunkY; chunkY < endChunkY; chunkY++) {
			if (Date.now() - start > this.MAX_DRAW_TIME) {
				this.breakDrawInit(chunkX, chunkY, startChunkY, endChunkX, endChunkY);
				return;
			}
			
            this.drawChunk(chunkX, chunkY);
        }
    }
	
	this.breakDrawing = false;
};

TiledCanvas.prototype.drawChunk = function drawChunk (chunkX, chunkY) {
    if (this.chunks[chunkX] && this.chunks[chunkX][chunkY]) {
        if (this.chunks[chunkX][chunkY] == "empty") return;
	
		this.chunks[chunkX][chunkY].lastDrawn = Date.now();

        this.ctx.drawImage(this.chunks[chunkX][chunkY].canvas, ((chunkX * this.settings.chunkSize) - this.leftTopX) * this.zoom, ((chunkY * this.settings.chunkSize) - this.leftTopY) * this.zoom, this.settings.chunkSize * this.zoom, this.settings.chunkSize * this.zoom);

		if (!this.breakDrawing && this.chunks[chunkX][chunkY].addedTime)
			this.drawFade(chunkX, chunkY);
		
    } else if(typeof this.requestUserChunk == "function") {
        this.requestChunk(chunkX, chunkY);
		
		if (this.breakDrawing) {
			this.ctx.fillStyle = "#456789";
			this.ctx.fillRect(((chunkX * this.settings.chunkSize) - this.leftTopX) * this.zoom, ((chunkY * this.settings.chunkSize) - this.leftTopY) * this.zoom, this.settings.chunkSize * this.zoom, this.settings.chunkSize * this.zoom);
		} else if (this.loadingImage) {
            this.ctx.drawImage(this.loadingImage, ((chunkX * this.settings.chunkSize) - this.leftTopX) * this.zoom, ((chunkY * this.settings.chunkSize) - this.leftTopY) * this.zoom, this.settings.chunkSize * this.zoom, this.settings.chunkSize * this.zoom);
        }
    }
};

TiledCanvas.prototype.drawFade = function drawFade (chunkX, chunkY) {
	if (!this.loadingImage) return;
	
	// If this chunk got recently added we want a fade effect
	// If we are breakdrawing though, we don't wanna be fancy
	var deltaAdded = Date.now() - this.chunks[chunkX][chunkY].addedTime;
	this.ctx.globalAlpha = Math.max(0, 1 - deltaAdded / this.settings.fadeTime);

	if (deltaAdded > this.settings.fadeTime)
		delete this.chunks[chunkX][chunkY].addedTime;

	// Force a redraw to avoid optimization of not drawing
	this.redrawOnce();

	var originalwidth = this.settings.chunkSize * this.zoom;
	var width = originalwidth * this.ctx.globalAlpha;
	this.ctx.drawImage(this.loadingImage,
		((chunkX * this.settings.chunkSize) - this.leftTopX) * this.zoom + (originalwidth - width) / 2,
		((chunkY * this.settings.chunkSize) - this.leftTopY) * this.zoom + (originalwidth - width) / 2,
		width,
		width);

	this.ctx.globalAlpha = 1;
};

TiledCanvas.prototype.drawToCanvas = function drawToCanvas (canvas, from, to) {		
	var minX = Math.min(from[0], to[0]),
	    maxX = Math.max(from[0], to[0]),
	    minY = Math.min(from[1], to[1]),
	    maxY = Math.max(from[1], to[1]);

	var width = maxX - minX,
	    height = maxY - minY;	

	var startChunkX = Math.floor(minX / this.settings.chunkSize),
	    endChunkX   = Math.ceil((minX + width) / this.settings.chunkSize),
	    startChunkY = Math.floor(minY / this.settings.chunkSize),
	    endChunkY   = Math.ceil((maxY + height) / this.settings.chunkSize);	

	var ctx = canvas.getContext("2d");

	for (var chunkX = startChunkX; chunkX < endChunkX; chunkX++) {
		for (var chunkY = startChunkY; chunkY < endChunkY; chunkY++) {
			if (this.chunks[chunkX] && this.chunks[chunkX][chunkY] && this.chunks[chunkX][chunkY] !== "empty") {
				ctx.drawImage(
					this.chunks[chunkX][chunkY].canvas,
					chunkX * this.settings.chunkSize - minX,
					chunkY * this.settings.chunkSize - minY
				);
			}
		}
	}
};

TiledCanvas.prototype.goto = function goto (x, y) {
    this.leftTopX = x;
    this.leftTopY = y;
    this.redrawOnce();
};

TiledCanvas.prototype.relativeZoom = function relativeZoom (zoom, pointX, pointY) {
    this.absoluteZoom(this.zoom * zoom, pointX, pointY);
};

TiledCanvas.prototype.absoluteZoom = function absoluteZoom (zoom, pointX, pointY) {
    
	
	this.reinitializeImageSmoothing();
	
	if (typeof pointX == "number" && typeof pointY == "number") {
		pointX = this.leftTopX + (pointX / this.zoom);
		pointY = this.leftTopY + (pointY / this.zoom);
		
		var ratioX = (pointX - this.leftTopX) / (this.canvas.width / this.zoom);
		var ratioY = (pointY - this.leftTopY) / (this.canvas.height / this.zoom);
		
		var newX = pointX - ((ratioX * this.canvas.width) / zoom);
		var newY = pointY - ((ratioY * this.canvas.height) / zoom);
		
		this.zoom = zoom;
		this.goto(newX, newY);
	} else {
		this.redrawOnce();
	}
};

TiledCanvas.prototype.reinitializeImageSmoothing = function reinitializeImageSmoothing () {
	var blurCanvas = this.settings.blurOnZoom || (this.zoom < this.settings.zoomLevelToPixelate);
	this.ctx.mozImageSmoothingEnabled = blurCanvas;
	this.ctx.webkitImageSmoothingEnabled = blurCanvas;
	this.ctx.msImageSmoothingEnabled = blurCanvas;
	this.ctx.imageSmoothingEnabled = blurCanvas;
};

TiledCanvas.prototype.execute = function execute () {
    this.executeNoRedraw();
    this.redrawOnce();
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
    this.requestChunkCallbackList = {};
    this.chunks = {};
    this.lastClear = Date.now();
};

// Request the chunk and call the callback once done
// Can be called as often as you'd like without breaking
// Callbacks are guarenteed to run in the order requestChunk is called in
TiledCanvas.prototype.requestChunk = function requestChunk (chunkX, chunkY, callback) {
    if (this.chunks[chunkX] && this.chunks[chunkX][chunkY]) {
        if (callback) callback();
		return;
    }
    
    // Request a chunk and redraw once we got it
    if (typeof this.requestUserChunk !== "function") return;
    this.requestChunkCallbackList = this.requestChunkCallbackList || {};

    if (this.requestChunkCallbackList[chunkX] && this.requestChunkCallbackList[chunkX][chunkY]) {
        if (!callback) return;
        // This chunk has already been requested, add to the callback list
        this.requestChunkCallbackList[chunkX][chunkY].push(callback);
    } else {
        this.requestChunkCallbackList[chunkX] = this.requestChunkCallbackList[chunkX] || {};

        if (callback) {
            // Create a callback list for this chunk
            this.requestChunkCallbackList[chunkX][chunkY] = [callback];
        } else {
            this.requestChunkCallbackList[chunkX][chunkY] = [];
        }

        var startTime = Date.now();
        this.requestUserChunk(chunkX, chunkY, function (image) {
            // If the request started before we cleared, ignore this
            if (this.lastClear > startTime) return;
            // For responsiveness make sure the callback doesnt happen in the same event frame
            this.setUserChunk(chunkX, chunkY, image);
        }.bind(this));
    }

    this.garbageCollect();
};

// This function can be overridden to make certain chunks not unload
TiledCanvas.prototype.beforeUnloadChunk = function beforeUnloadChunk () { return true; }

/*
	Tries to remove as many chunks as possible that have not been used for more than MIN_INACTIVE_UNLOAD_TIME
	Chunks that have been drawn on will never be removed
	Only removes chunk if we are over the limit
*/
TiledCanvas.prototype.garbageCollect = function garbageCollect () {
	if (this.chunkCount() > this.settings.maxLoadedChunks) {
		for (var x in this.chunks) {
			for (var y in this.chunks[x]) {
				if (this.canBeUnloaded(x, y) && this.beforeUnloadChunk(x, y)) {
					this.chunks[x][y] = null;
					delete this.chunks[x][y];
				}
			}
		}
	}
};

/*
	Returns the amount of loaded, non-empty chunks
*/
TiledCanvas.prototype.chunkCount = function chunkCount () {
	var count = 0;
	
	for (var x in this.chunks)
		for (var y in this.chunks[x])
			if (this.chunks[x][y] != "empty" && this.chunks[x][y])
				count++;
	
	return count;
};

TiledCanvas.prototype.isInView = function isInView (cx, cy) {
	var minX = Math.floor(this.leftTopX / this.settings.chunkSize);
	var minY = Math.floor(this.leftTopY / this.settings.chunkSize);
	var maxX = Math.ceil((this.leftTopX + this.canvas.width / this.zoom) / this.settings.chunkSize);
	var maxY = Math.ceil((this.leftTopY + this.canvas.height / this.zoom) / this.settings.chunkSize);

	return cx >= minX && cx <= maxX &&
	       cy >= minY && cy <= maxY;
};

TiledCanvas.prototype.canBeUnloaded = function canBeUnloaded (cx, cy) {
	return this.chunks[cx] &&
	       this.chunks[cx][cy] &&
	       Date.now() - (this.chunks[cx][cy].lastDrawn || 0) > this.MIN_INACTIVE_UNLOAD_TIME &&
	       !this.chunks[cx][cy].hasBeenDrawnOn &&
		   !this.isInView(cx, cy);
};

TiledCanvas.prototype.setUserChunk = function setUserChunk (chunkX, chunkY, image) {
    // Don't set the user chunk twice
    if (this.chunks[chunkX] && this.chunks[chunkX][chunkY]) return;

    // If the image is falsy and there is no queue then this chunk is transparent
    // for performance reasons empty chunks should not allocate memory
    if (!image && (!this.requestChunkCallbackList[chunkX] || this.requestChunkCallbackList[chunkX][chunkY].length == 0)) {
        this.chunks[chunkX] = this.chunks[chunkX] || {};
        this.chunks[chunkX][chunkY] = "empty";
        delete this.requestChunkCallbackList[chunkX][chunkY];
		this.redrawOnce(); // Clear the possible loading image
        return;
    }

    // Draw the chunk
    this.chunks[chunkX] = this.chunks[chunkX] || {};
    this.chunks[chunkX][chunkY] =  this.newCtx(this.settings.chunkSize, this.settings.chunkSize, -chunkX * this.settings.chunkSize, -chunkY * this.settings.chunkSize);
    this.chunks[chunkX][chunkY].addedTime = Date.now();

    if (image) this.chunks[chunkX][chunkY].drawImage(image, chunkX * this.settings.chunkSize, chunkY * this.settings.chunkSize);

    // Run all callbacks
    var callbackList = this.requestChunkCallbackList[chunkX][chunkY];
    for (var k = 0; k < callbackList.length; k++) {
        callbackList[k]();
    }

    // Do a full redraw of the tiled canvas
    this.redrawOnce();

    delete this.requestChunkCallbackList[chunkX][chunkY];
};

TiledCanvas.prototype.copyArray = function copyArray (arr) {
    var temp = [];
    for (var k = 0; k < arr.length; k++) {
        temp[k] = arr[k];
    }
    return temp;
};

TiledCanvas.prototype.executeChunk = function executeChunk (chunkX, chunkY, queue) {
    // Executes the current queue on a chunk
    // If queue is set execute that queue instead
    this.chunks[chunkX] = this.chunks[chunkX] || [];
 
    if (!this.chunks[chunkX][chunkY] || this.chunks[chunkX][chunkY] == "empty") {
        // This chunk has never been painted to before
        // We first have to ask what this chunk looks like
        // Remember the Queue untill we got the chunk
        // if we already remembered a queue then add this queue to it
        // Only do this when we actually want to use userdefined chunks
        if (typeof this.requestUserChunk == "function" && this.chunks[chunkX][chunkY] !== "empty") {
            this.requestChunk(chunkX, chunkY, function (queue) {
                this.executeChunk(chunkX, chunkY, queue);
            }.bind(this, this.copyArray(queue || this.contextQueue)))
            return;
        } else {
            this.chunks[chunkX][chunkY] =  this.newCtx(this.settings.chunkSize, this.settings.chunkSize, -chunkX * this.settings.chunkSize, -chunkY * this.settings.chunkSize);
        }
    }

    var ctx = this.chunks[chunkX][chunkY];
    var queue = queue || this.contextQueue;

    for (var queuekey = 0; queuekey < queue.length; queuekey++) {
        if (typeof ctx[queue[queuekey][0]] === 'function') {
            this.executeQueueOnChunk(ctx, queue[queuekey]);
        } else {
            ctx[queue[queuekey][0]] = queue[queuekey][1];
        }
    }
};

TiledCanvas.prototype.executeQueueOnChunk = function executeQueueOnChunk (ctx, args) {
    ctx[args[0]].apply(ctx, Array.prototype.slice.call(args, 1));
    ctx.hasBeenDrawnOn = true;
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
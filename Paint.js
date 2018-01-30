function Paint (container, settings) {
	this.eventHandlers = {};
	this.settings = this.utils.merge(this.utils.copy(settings), this.defaultSettings);

	this.container = container;
	this.boundingBoxList = [];

	this.scale = [1, 1]; // Used for horizontal and vertical mirror
	this.rotation = 0; // Rotation in degrees
	
	this.frames = []; // The frames that will be displayed
	// Contains objects of the form: {leftTop: [0,0], width: 500, height: 100, shift: 200, opacity: 0.4}

	this.addCanvas(container);
	this.resize();

	this.controlContainer = container.appendChild(document.createElement("div"));
	this.controlContainer.className = "control-container";
	this.controls = new Controls(this.controlContainer, this.createControlArray());

	this.addCoordDom(container);

	// Set tool values
	this.changeTool("brush");
	this.setColor(new tinycolor());
	this.changeToolSize(5, true);

	$(this.controls.byName["tool-color"].input).spectrum("set", this.current_color);

	this.localDrawings = [];
	this.paths = {};
	this.localUserPaths = [];

	// Drawings that have not yet finalized
	// The server still has to write them to image
	// They could still be undone
	this.publicdrawings = [];
	
	this.altPressed = false;
	this.rightClick = false;
	this.leftClick = false;
	this.keyMap = []; // https://stackoverflow.com/questions/29266602/javascript-when-having-pressed-2-keys-simultaneously-down-leaving-one-of-them

	window.addEventListener("resize", this.resize.bind(this));
	window.addEventListener("keypress", this.keypress.bind(this));
	window.addEventListener("keydown", this.keydown.bind(this));
	window.addEventListener("keyup", this.keyup.bind(this));
	window.addEventListener('wheel', this.wheel.bind(this));

	//addEventListener didn't work
	window.onmouseout = function detectAltTab() {
		this.altPressed = false;
	}.bind(this);
	
	//introJs().setOptions({ 'tooltipPosition': 'auto', 'showProgress': true }).start();
}

Paint.prototype.MAX_RANDOM_COORDS = 1048576;
Paint.prototype.FIX_CANVAS_PIXEL_SIZE = 0;
Paint.prototype.PATH_PRECISION = 1000;
Paint.prototype.MIN_PATH_WIDTH = 1.001;

Paint.prototype.defaultSettings = {
	maxSize: 100,
	maxLineLength: 200
};

Paint.prototype.defaultShortcuts = {

};

// Redraws everything taking into account mirroring and rotation
Paint.prototype.redrawAll = function redrawAll () {
	for (var k = 0; k < this.canvasArray.length; k++) {
		var ctx = this.canvasArray[k].getContext("2d");

		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		ctx.restore();

		ctx.setTransform(
			this.scale[0], 0, 0,
			this.scale[1], this.canvasArray[k].width / 2, this.canvasArray[k].height / 2
		);

		ctx.rotate(this.rotation * Math.PI / 180);
		ctx.translate(-this.canvasArray[k].width / 2, -this.canvasArray[k].height / 2);
	}

	this.background.redrawOnce();
	this.public.redrawOnce();
	this.local.redrawOnce();

	this.redrawPaths();
	this.redrawFrames();
};

Paint.prototype.setHorizontalMirror = function setHorizontalMirror (value) {
	this.scale[0] = value ? -1 : 1;
	this.redrawAll();

	this.dispatchEvent({
		type: "canvaschange",
		rotation: this.rotation,
		scale: this.scale
	});
};

Paint.prototype.setVerticalMirror = function setVerticalMirror (value) {
	this.scale[1] = value ? -1 : 1;
	this.redrawAll();

	this.dispatchEvent({
		type: "canvaschange",
		rotation: this.rotation,
		scale: this.scale
	});
};

Paint.prototype.setRotation = function setRotation (value) {
	this.rotation = value % 360;
	this.redrawAll();

	this.dispatchEvent({
		type: "canvaschange",
		rotation: this.rotation,
		scale: this.scale
	});
};

Paint.prototype.addCanvas = function addCanvas (container) {
	// The background pngs
	var backgroundC = container.appendChild(this.createCanvas("background"));
	backgroundC.oncontextmenu = function() {
		 return false;  
	} 
	
	// The things that have been drawn and we already know the order of
	// but have yet to be finalized
	var publicC = container.appendChild(this.createCanvas("public"));
	publicC.oncontextmenu = function() {
		 return false;  
	} 
	// This canvas is used to display parts of the background and public
	// The use case is to display the previous frames in an animation
	var frameC = container.appendChild(this.createCanvas("frames"));
	frameC.oncontextmenu = function() {
		 return false;  
	} 
	// The things we drew but the server hasn't confirmed yet
	var localC  = container.appendChild(this.createCanvas("local"));
	localC.oncontextmenu = function() {
		 return false;  
	} 
	// Canvas for things like cursor that should always be at the top
	var effectC = container.appendChild(this.createCanvas("effect"));
	effectC.oncontextmenu = function() {
		 return false;  
	} 
	var backgroundCtx = backgroundC.getContext("2d");
	backgroundCtx.mozImageSmoothingEnabled = false;
	backgroundCtx.webkitImageSmoothingEnabled = false;
	backgroundCtx.msImageSmoothingEnabled = false;
	backgroundCtx.imageSmoothingEnabled = false;

	this.background = new TiledCanvas(backgroundC);
	this.public = new TiledCanvas(publicC);
	this.local = new TiledCanvas(localC);

	this.public.requestUserChunk = function requestPublicUserChunk (cx, cy, callback) {
		// We actually dont have background chunks, but we have to make sure
		// the background canvas requests background images when we get
		// drawings for that chunk so that no race condition happens when we
		// finalize all the drawings
		callback();
		this.background.requestChunk(cx, cy);
	}.bind(this);
	
	this.public.beforeUnloadChunk = function beforeUnloadChunk (cx, cy) {
		if((this.public.canBeUnloaded(cx, cy) || (this.public.chunks[cx] && this.public.chunks[cx][cy] == "empty")) &&
		   (this.background.canBeUnloaded(cx, cy) || (this.background.chunks[cx] && this.background.chunks[cx][cy] == "empty"))) {
			console.log("Unloading chunk", cx, cy);
			this.background.chunks[cx][cy] = null;
			delete this.background.chunks[cx][cy];
			this.public.chunks[cx][cy] = null;
			delete this.public.chunks[cx][cy];
			return true;
		}
		
		return false;
	}.bind(this);
	
	this.background.beforeUnloadChunk = this.public.beforeUnloadChunk;

	this.effectsCanvas = effectC;
	this.effectsCanvasCtx = effectC.getContext("2d");

	effectC.addEventListener("mousedown", this.exectool.bind(this));
	effectC.addEventListener("mousemove", this.exectool.bind(this));
	effectC.addEventListener("mouseup", this.exectool.bind(this));
	effectC.addEventListener("mouseleave", this.exectool.bind(this));

	effectC.addEventListener("touchstart", this.exectool.bind(this));
	effectC.addEventListener("touchmove", this.exectool.bind(this));
	effectC.addEventListener("touchend", this.exectool.bind(this));

	this.canvasArray = [backgroundC, publicC, frameC, localC, effectC];

	// Used as the point where new canvasses should be added
	// This way effectC stays on top
	this.lastCanvas = localC;

	// The paths are still being drawn, they are on top of everything else
	this.pathCanvas = this.newCanvasOnTop("paths");
	this.pathContext = this.pathCanvas.getContext("2d");
	this.framesContext = frameC.getContext("2d");
};

Paint.prototype.addCoordDom = function addCoordDom (container) {
	this.coordDiv = container.appendChild(document.createElement("div"));
	this.coordDiv.className = "mouse-coords";

	this.coordDiv.appendChild(document.createTextNode("x:"));
	var xInput = this.coordDiv.appendChild(document.createElement("input"));
	this.coordDiv.appendChild(document.createTextNode("y:"));
	var yInput = this.coordDiv.appendChild(document.createElement("input"));

	xInput.type = "number";
	yInput.type = "number";

	xInput.min = -this.MAX_RANDOM_COORDS;
	yInput.min = -this.MAX_RANDOM_COORDS;

	xInput.max = this.MAX_RANDOM_COORDS;
	yInput.max = this.MAX_RANDOM_COORDS;

	xInput.addEventListener("input", function (event) {
		this.goto(parseInt(event.target.value) - this.canvasArray[0].width / this.public.zoom / 2 || 0, this.public.leftTopY);
	}.bind(this));

	yInput.addEventListener("input", function (event) {
		this.goto(this.public.leftTopX, parseInt(event.target.value) - this.canvasArray[0].height / this.public.zoom / 2 || 0);
	}.bind(this));

	var randomButton = this.coordDiv.appendChild(document.createElement("div"));
	randomButton.className = "control-button random-button";

	var randomButtonImage = randomButton.appendChild(document.createElement("img"));
	randomButtonImage.src = "images/icons/randomlocation.png";
	randomButtonImage.alt = "Jump to random location";
	randomButtonImage.title = "Jump to random location";
	randomButton.setAttribute("data-intro", "Since you are new, you are restricted on where you can draw. Use this button to find a spot.");

	randomButton.addEventListener("click", function () {
		var maxCoords = this.MAX_RANDOM_COORDS;
		this.goto(Math.random() * maxCoords * 2 - maxCoords, Math.random() * maxCoords * 2 - maxCoords);
	}.bind(this));
};

Paint.prototype.setMouseCoords = function setMouseCoords (x, y) {
	// Assume first input is x, second is y
	var xSet = false;
	for (var k = 0; k < this.coordDiv.children.length; k++) {
		if (this.coordDiv.children[k].type == "number") {
			this.coordDiv.children[k].value = xSet ? y.toFixed() : x.toFixed();
			if (xSet) return;
			xSet = true;
		}
	}
};

Paint.prototype.newCanvasOnTop = function newCanvasOnTop (name) {
	var canvas = this.createCanvas(name || "foreign");

	// Insert the canvas behind the current last canvas
	this.lastCanvas.parentNode.insertBefore(canvas, this.lastCanvas.nextSibling);

	// Put it as new canvas, put it in the canvasarray and return
	this.lastCanvas = canvas;
	this.canvasArray.push(canvas);

	// Set the coords
	canvas.leftTopX = this.public.leftTopX;
	canvas.leftTopY = this.public.leftTopY;

	// Invalidate canvas size
	this.resize();

	return canvas;
};

// Resets the paint (background, position, paths, ...)
Paint.prototype.clear = function clear () {
	this.public.clearAll();
	this.background.clearAll();
	this.local.clearAll();

	this.paths = {};
	this.localUserPaths = [];
	this.publicdrawings = [];

	this.goto(0, 0);
};

Paint.prototype.goto = function goto (worldX, worldY) {
	if (typeof worldX !== "number") console.warn("worldX in goto was not a number!");
	if (typeof worldY !== "number") console.warn("worldY in goto was not a number!");

	if (worldX !== worldX) console.warn("worldX was NaN");
	if (worldY !== worldY) console.warn("worldY was NaN");

	// Move both local and public tiledcanvas and set all canvas leftTopX/Y properties
	this.background.goto(worldX, worldY);
	this.local.goto(worldX, worldY);
	this.public.goto(worldX, worldY);

	for (var k = 0; k < this.canvasArray.length; k++) {
		this.canvasArray[k].leftTopX = this.public.leftTopX;
		this.canvasArray[k].leftTopY = this.public.leftTopY;
	}

	this.redrawPaths();
	this.redrawFrames();
	this.dispatchEvent({
		type: "move",
		leftTopX: worldX,
		leftTopY: worldY
	});
};

Paint.prototype.finalizeAll = function finalizeAll (amountToKeep) {
	this.drawDrawings("background", this.publicdrawings.slice(0, this.publicdrawings.length - (amountToKeep || 0)));
	this.publicdrawings.splice(0, this.publicdrawings.length - (amountToKeep || 0));

	this.public.clearAll();
	this.drawDrawings("public", this.publicdrawings);
};

Paint.prototype.createCanvas = function createCanvas (name) {
	var canvas = document.createElement("canvas");
	canvas.className = "paint-canvas paint-canvas-" + name;
	return canvas;
};

// Invalidate the canvas size
Paint.prototype.resize = function resize () {
	for (var cKey = 0; cKey < this.canvasArray.length; cKey++) {
		this.canvasArray[cKey].width = this.canvasArray[cKey].offsetWidth;
		this.canvasArray[cKey].height = this.canvasArray[cKey].offsetHeight;
	}
	this.public.reinitializeImageSmoothing();
	this.background.reinitializeImageSmoothing();
	this.local.reinitializeImageSmoothing();
	this.redrawAll();

	for (var k = 0; k < this.boundingBoxList.length; k++) {
		this.boundingBoxList[k].boundingBoxCache = this.boundingBoxList[k].getBoundingClientRect();
	}
};

Paint.prototype.keypress = function keypress (event) {
	var key = event.keyCode || event.which;

	if (event.target == document.body) {

		if (key == 99) {
			console.log("Pressed C, toggling color selector.");
			$(this.controls.byName["tool-color"].input).spectrum("toggle");
		}

		if (key > 47 && key < 58) {
			var number = key - 48;
			this.setColor(tinycolor(this.current_color.toRgb()).setAlpha(number / 9));
		}

		if (key == 91 || key == 44 || key == 45 || key == 219
		 || key == 186 || key == 96)
			this.changeToolSize(--this.current_size, true);
		
		if (key == 93 || key == 46 || key == 221
		 || key == 187 || key == 43 || key == 61)
			this.changeToolSize(++this.current_size, true);

		if (key == 109)
			this.setHorizontalMirror(this.scale[0] == 1);

		if (key == 107)
			this.setVerticalMirror(this.scale[1] == 1);

		var toolShortcuts = {
			98: "brush",
			103: "grab",
			108: "line",
			112: "picker",
			116: "text",
			118: "picker",
			122: "zoom"
		};

		if (toolShortcuts[key]) {
			console.log("Switching tool to " + toolShortcuts[key]);
			this.changeTool(toolShortcuts[key]);
		}
	}
};

Paint.prototype.keydown = function keydown (event) {
	var key = event.keyCode || event.which;

	if (event.target == document.body) {
		this.keyMap[key] = true;		
		
		if ( event.ctrlKey && (key == 32 || this.keyMap[32])) {
			if(this.current_tool !== "zoom") {
				this.previous_tool = this.current_tool;
				this.changeTool("zoom");
			}
			return;
		}

		if (key == 27) {
			this.setRotation(0);
			this.setHorizontalMirror(false);
			this.setVerticalMirror(false);
		}

		if (this.current_tool !== "grab" || this.previous_tool == undefined && key == 32) {
			this.previous_tool = this.current_tool;
			this.changeTool("grab");
		}

		if (this.current_tool !== "picker" && key == 18) {
			this.previous_tool = this.current_tool;
			this.changeTool("picker");
			this.altPressed = true;
		}

		if (event.ctrlKey && event.keyCode == 90) {
			this.undo();
			event.preventDefault();
		}
	}
};

Paint.prototype.keyup = function keyup (event) {
	var key = event.keyCode || event.which;

	if (event.target == document.body) {
		this.keyMap[key] = null;
		
		if (this.current_tool == "zoom" && event.ctrlKey || key == 32 || this.keyMap[32]) {
			this.changeTool(this.previous_tool);
			return;
		}

		if (this.current_tool == "grab" && key == 32 && this.previous_tool) {
			this.changeTool(this.previous_tool);
		}
		if (key == 18) {
			this.altPressed = false;
		}
		if (this.current_tool == "picker" && key == 18 && this.previous_tool) {
			this.changeTool(this.previous_tool);
		}
	}
};

Paint.prototype.wheel = function wheel (event) { // <---- new function
	if (this.altPressed) {
		var targetCoords = this.getCoords(event);
		var scaledCoords = this.scaledCoords(targetCoords, event);
		
		var x = scaledCoords[0];
		var y = scaledCoords[1];
		var zoomFactor = 1.1;

		if (event.deltaY < 0){
			//scrolling up
			this.zoomToPoint(this.public.zoom * ( zoomFactor ), x, y);
		} else
		if (event.deltaY > 0){
			//scrolling down
			this.zoomToPoint(this.public.zoom * ( 1 / zoomFactor ), x, y);
		}
	}
};

// From, to: [x, y]
// Returns a data url of the background + public layer
// Returns a canvas if returnCanvas is true
Paint.prototype.exportImage = function exportImage (from, to, returnCanvas) {
	var canvas = document.createElement("canvas");
	canvas.width = Math.abs(from[0] - to[0]);
	canvas.height = Math.abs(from[1] - to[1]);

	this.background.drawToCanvas(canvas, from, to);
	this.public.drawToCanvas(canvas, from, to);

	if (returnCanvas) return canvas;
	return canvas.toDataURL();
};

Paint.prototype.redrawLocalDrawings = function redrawLocalDrawings () {
	this.redrawLocals();
};

// Shedule for the paths to be redrawn in the next frame
Paint.prototype.redrawPaths = function redrawPaths () {
	if (this.redrawPathsTimeout) return;
	this.redrawPathsTimeout = requestAnimationFrame(this._redrawPaths.bind(this));
};

// Shedule for the frames to be redrawn in the next frame
Paint.prototype.redrawFrames = function redrawFrames () {
	if (this.redrawFramesTimeout) return;
	this.redrawFramesTimeout = requestAnimationFrame(this._redrawFrames.bind(this));
};

Paint.prototype._redrawFrames = function _redrawFrames () {
	if (this._framesHaveBeenDrawn) {
		this.framesContext.clearRect(0, 0, this.framesContext.canvas.width, this.framesContext.canvas.height);
		this._framesHaveBeenDrawn = false;
	}

	delete this.redrawFramesTimeout;
	
	for (var k = 0; k < this.frames.length; k++) {
		this.drawFrame(this.frames[k], this.framesContext);
		this._framesHaveBeenDrawn = true;
	}
};

Paint.prototype.drawFrame = function drawFrame (frame, framesContext) {
	// TODO: Optimization possibility: only draw frames that are in vision
	if (frame.disabled) return;
	
	var to = [frame.leftTop[0] + frame.width, frame.leftTop[1] + frame.height];
	var frameCanvas = this.exportImage(frame.leftTop, to, true);
	
	var relativeX = frame.leftTop[0] - this.public.leftTopX + frame.shift;
	var relativeY = frame.leftTop[1] - this.public.leftTopY;
	
	framesContext.globalAlpha = frame.opacity;
	framesContext.drawImage(frameCanvas, relativeX * this.public.zoom, relativeY * this.public.zoom, frameCanvas.width * this.public.zoom, frameCanvas.height * this.public.zoom);
};

Paint.prototype._redrawPaths = function _redrawPaths () {
	this.pathContext.clearRect(0, 0, this.pathContext.canvas.width, this.pathContext.canvas.height);
	delete this.redrawPathsTimeout;

	for (var pathId in this.paths) {
		this.drawPath(this.paths[pathId]);
	}

	for (var pathId = 0; pathId < this.localUserPaths.length; pathId++) {
		this.drawPath(this.localUserPaths[pathId]);
	}
};

Paint.prototype.drawPathTiledCanvas = function drawPathTiledCanvas (path, ctx, tiledCanvas) {
	var minX = path.points[0][0],
	    minY = path.points[0][1],
	    maxX = path.points[0][0],
	    maxY = path.points[0][1];

	// Start on the first point
	ctx.beginPath();
	ctx.moveTo(path.points[0][0], path.points[0][1] + this.FIX_CANVAS_PIXEL_SIZE); // Might not be necessary

	// Connect a line between all points
	for (var pointId = 1; pointId < path.points.length; pointId++) {
		ctx.lineTo(path.points[pointId][0], path.points[pointId][1] + this.FIX_CANVAS_PIXEL_SIZE); // Might not be necessary

		minX = Math.min(path.points[pointId][0], minX);
		minY = Math.min(path.points[pointId][1], minY);
		maxX = Math.max(path.points[pointId][0], maxX);
		maxY = Math.max(path.points[pointId][1], maxY);
	}

	ctx.strokeStyle = path.color.toRgbString();
	ctx.lineWidth = path.size; // Might not be necessary

	ctx.lineJoin = "round";
	ctx.lineCap = "round";

	ctx.stroke();
	tiledCanvas.drawingRegion(minX, minY, maxX, maxY, path.size);
	tiledCanvas.execute();
	
	if (tiledCanvas == this.public || tiledCanvas == this.background)
		this.redrawFrames();
};

Paint.prototype.drawPath = function drawPath (path, ctx, tiledCanvas) {
	var ctx = ctx || this.pathContext;
	if (!path.points || !path.points[0]) return;

	if (tiledCanvas) {
		this.drawPathTiledCanvas(path, ctx, tiledCanvas);
		return;
	}

	// Start on the first point
	ctx.beginPath();
	var x = path.points[0][0] - this.public.leftTopX,
	    y = path.points[0][1] - this.public.leftTopY;
	ctx.moveTo(x * this.public.zoom, y * this.public.zoom + this.FIX_CANVAS_PIXEL_SIZE);

	var minX = Infinity;
	var minY = Infinity;
	var maxX = -Infinity;
	var maxY = -Infinity;

	// Connect a line between all points
	for (var pointId = 1; pointId < path.points.length; pointId++) {
		var x = path.points[pointId][0] - this.public.leftTopX,
		    y = path.points[pointId][1] - this.public.leftTopY;
		ctx.lineTo(x * this.public.zoom, y * this.public.zoom + this.FIX_CANVAS_PIXEL_SIZE);
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
	}

	if (path.color.type == "gradient") {
		var lastX = path.points[path.points.length - 1][0];
		var lastY = path.points[path.points.length - 1][1];

		var gradient = ctx.createLinearGradient(minX, 0,
		                                        maxX, 0);

		for (var k = 0; k < path.color.length; k++) {
			gradient.addColorStop(path.color[k].pos, path.color[k].color);
		}

		ctx.strokeStyle = gradient;
	} else {
		path.color = tinycolor(path.color);
		ctx.strokeStyle = path.color.toRgbString();
	}

	ctx.lineWidth = path.size * this.public.zoom;

	ctx.lineJoin = "round";
	ctx.lineCap = "round";

	ctx.stroke();
};

Paint.prototype.redrawLocals = function redrawLocals (noclear) {
	// Force the redrawing of locals in this frame
	this.local.clearAll();
	this.localDrawings.forEach(this.drawDrawing.bind(this, "local"));

	this.local.redrawOnce();
}

Paint.prototype.removeLocalDrawing = function removeLocalDrawing (drawing) {
	var index = this.localDrawings.indexOf(drawing);
	this.localDrawings.splice(index, 1);
	this.redrawLocalDrawings();
};

// From, to: [0, 0]
// frames: number of frames
Paint.prototype.addFrame = function addFrame (from, to, frames, opacity, gutter, shift, customWidth) {
	var width = Math.abs(from[0] - to[0]);
	this.frames.push({
		leftTop: [Math.min(from[0], to[0]), Math.min(from[1], to[1])],
		width: customWidth || width,
		height: Math.abs(from[1] - to[1]),
		shift: shift || (width / frames),
		opacity: opacity,
		gutter: gutter || 0
	});
	this.redrawFrames();
};

Paint.prototype.addPublicDrawings = function addPublicDrawings (drawings) {
	for (var k = 0; k < drawings.length; k++) this.addPublicDrawing(drawings[k]);
};

Paint.prototype.addPublicDrawing = function addPublicDrawing (drawing) {
	this.publicdrawings.push(drawing);
	this.drawDrawing("public", drawing);
	this.redrawFrames();
};

Paint.prototype.undodrawings = function undodrawings (socketid, all) {
	for (var k = this.publicdrawings.length - 1; k >= 0; k--) {
		if (this.publicdrawings[k].id == socketid || this.publicdrawings[k].socketid == socketid) {
			this.publicdrawings.splice(k, 1);

			if (!all) break;
		}
	}

	this.public.clearAll();
	this.drawDrawings("public", this.publicdrawings);
	this.redrawFrames();
};

Paint.prototype.undo = function undo () {
	this.dispatchEvent({
		type: "undo"
	});
};

Paint.prototype.addPath = function addPath (id, props) {
	this.paths[id] = props;
	this.paths[id].points = this.paths[id].points || [];
	this.redrawPaths();
	this.redrawFrames();
};

Paint.prototype.addPathPoint = function addPathPoint (id, point) {
	if (!this.paths[id]) {
		console.error("Path ", id, " not known. Can't add point.");
		return;
	}

	this.paths[id].points.push(point);
	this.redrawPaths();
	this.redrawFrames();
};

Paint.prototype.generateGrid = function generateGrid (leftTop, squares, sqwidth, sqheight, gutter) {
	for (var k = 0; k < squares; k++) {
		var localLeftTop = [leftTop[0] + k * sqwidth + k * gutter, leftTop[1]];
		this.addUserPath();
		this.addUserPathPoint(localLeftTop);
		this.addUserPathPoint([localLeftTop[0] + sqwidth, localLeftTop[1]]);
		this.addUserPathPoint([localLeftTop[0] + sqwidth, localLeftTop[1] + sqheight]);
		this.addUserPathPoint([localLeftTop[0]          , localLeftTop[1] + sqheight]);
		this.addUserPathPoint(localLeftTop);
		this.endUserPath();
	}
};

Paint.prototype.previewGrid = function previewGrid (leftTop, squares, sqwidth, sqheight, gutter) {
	var context = this.effectsCanvasCtx;
	context.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
	var x = (leftTop[0] - this.public.leftTopX) * this.public.zoom,
	    y = (leftTop[1] - this.public.leftTopY) * this.public.zoom;
	context.setLineDash([]); // overwrite the selection tool line dash effect
	for (var k = 0; k < squares; k++) {
		var localLeftTop = [x + k * sqwidth * this.public.zoom + k * gutter * this.public.zoom, y];
		context.beginPath();

		context.rect(localLeftTop[0], localLeftTop[1], sqwidth * this.public.zoom, sqheight * this.public.zoom);
		context.lineWidth = this.current_size * this.public.zoom;
		context.strokeStyle = this.current_color.toRgbString();
		context.stroke();
	}
};

// Draw the given path on the public layer and remove it
Paint.prototype.finalizePath = function finalizePath (id) {
	if (!this.paths[id]) {
		return;
	}

	this.drawPath(this.paths[id], this.public.context, this.public);
	this.publicdrawings.push(this.paths[id]);
	this.removePath(id);
};

Paint.prototype.removePath = function removePath (id) {
	delete this.paths[id];
	this.redrawPaths();
};

// Remove the given point of the given path
// Returns true if removed, false if not
Paint.prototype.removePathPoint = function removePathPoint (id, point) {
	for (var k = this.paths.points.length - 1; k >= 0; k++) {
		if (this.paths.points[k] == point) {
			this.paths.points.splice(k, 1);
			this.redrawPaths();
			return true;
		}
	}

	return false;
};

// Function that should be called when a new drawing is added
// because of a user interaction. Calls the userdrawing event
Paint.prototype.addUserDrawing = function addUserDrawing (drawing) {
	this.drawDrawing("local", drawing);
	this.localDrawings.push(drawing);

	this.dispatchEvent({
		type: "userdrawing",
		drawing: drawing,
		removeDrawing: this.removeLocalDrawing.bind(this, drawing)
	});
};

// Functions for the current user path (user path = path we are drawing)
Paint.prototype.addUserPath = function addUserPath () {
	this.localUserPaths.push({
		type: "path",
		color: this.current_color,
		size: this.current_size
	});

	this.dispatchEvent({
		type: "startuserpath",
		props: this.localUserPaths[this.localUserPaths.length - 1]
	});
};

Paint.prototype.addUserPathPoint = function dispatchPathPoint (point) {
	var lastPath = this.localUserPaths[this.localUserPaths.length - 1];
	lastPath.points = lastPath.points || [];
	lastPath.points.push(point);

	this.dispatchEvent({
		type: "userpathpoint",
		point: point,
		removePathPoint: this.removeUserPathPoint.bind(this, lastPath, point)
	});

	this.redrawPaths();
};

Paint.prototype.endUserPath = function endUserPath () {
	var lastPath = this.localUserPaths[this.localUserPaths.length - 1];
	
	if (typeof lastPath === 'undefined')
		return;
	
	this.dispatchEvent({
		type: "enduserpath",
		removePath: this.removeUserPath.bind(this, lastPath)
	});
};

Paint.prototype.removeUserPathPoint = function removeUserPathPoint (path, point) {
	for (var k = 0; k < path.points.length; k++) {
		if (path.points[k] == point) {
			path.points.splice(k, 1);
			return;
		}
	}
};

Paint.prototype.removeUserPath = function removeUserPath (path, finalize, id) {
	path.socketid = id;
	this.publicdrawings.push(path);
	for (var k = 0; k < this.localUserPaths.length; k++) {
		if (this.localUserPaths[k] == path) {
            if (finalize)
                this.drawPath(path, this.public.context, this.public);

			this.localUserPaths.splice(k, 1);
			this.redrawPaths();
			return true;
		}
	}

	return false;
};

// Put the drawings on the given layer ('background', 'public', 'local', 'effects')
// This function forces a redraw after the drawings have been added
Paint.prototype.drawDrawings = function drawDrawings (layer, drawings) {
	for (var dKey = 0; dKey < drawings.length; dKey++) {
		if (typeof this.drawFunctions[drawings[dKey].type] == "function")
			this.drawFunctions[drawings[dKey].type].call(this, this[layer].context, drawings[dKey], this[layer]);
		else if (drawings[dKey].points)
			this.drawFunctions.path.call(this, this[layer].context, drawings[dKey], this[layer]);
		else
			console.error("Unkown drawing", drawings[dKey]);

	}
	
	this[layer].redrawOnce();
};

// Put the drawing on the given layer ('background', 'public', 'local', 'effects')
// This function only redraws at the next browser drawframe
Paint.prototype.drawDrawing = function drawDrawing (layer, drawing) {
	this.drawFunctions[drawing.type].call(this, this[layer].context, drawing, this[layer]);
	this[layer].redrawOnce();
};

// User interaction on the canvas
Paint.prototype.exectool = function exectool (event) {
	// Don't do the default stuff
	if (event && typeof event.preventDefault == "function")
		event.preventDefault();
	
	if (event.type == "mousedown") {
		if (event.button === 0) {
			this.leftClick = true;
		}
		if (event.button === 2) {
			this.rightClick = true;
		}
	}
	else if (event.type == "mouseup") {
		if (event.button === 0) {
			this.leftClick = false;
		}
		if (event.button === 2) {
			this.rightClick = false;
		}
	}

	if (typeof this.tools[this.current_tool] == "function") {
		if (this.rightClick && event.altKey) { // right click
			this.tools["change_size"](this, event);
		} else if (this.leftClick && this.keyMap[82]) {
			this.tools["change_rotation"](this, event);
		}
		else
			this.tools[this.current_tool](this, event);
	}

	if (typeof event == "object") {
		var coords = this.getCoords(event);
		coords = this.scaledCoords(coords, event);
		coords[0] = this.local.leftTopX + (coords[0] / this.local.zoom);
		coords[1] = this.local.leftTopY + (coords[1] / this.local.zoom);

		this.setMouseCoords(coords[0], coords[1]);
	}

	if (document.activeElement && document.activeElement !== this.textToolInput)
		document.activeElement.blur();
};

Paint.prototype.changeTool = function changeTool (tool) {
	this.exectool("remove");
	this.current_tool = tool;
	this.effectsCanvasCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);

	for (var name in this.controls.byName)
		this.controls.byName[name].input.classList.remove("paint-selected-tool");

	this.controls.byName[tool].input.classList.add("paint-selected-tool");
	this.exectool("setup");
};

Paint.prototype._changeColor = function _changeColor (color) {
	this.current_color = tinycolor(color);
	this.currentColorMode = "color";
	this.effectsCanvasCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
};

// Change gradient coming from the gradientcreator
Paint.prototype._changeGradient = function _changeGradient (event) {
	this.current_color = event.stops;
	this.current_color.type = "gradient";
	this.effectsCanvasCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
};

Paint.prototype.changeToolSize = function changeToolSize (size, setinput) {
	if (this.brushing) return;

	if (size > this.settings.maxSize) size = this.settings.maxSize;
	if (size <= 1) size = this.MIN_PATH_WIDTH;
	if (size == 2.001) size = 2;

	this.current_size = parseFloat(size);
	
	this.effectsCanvasCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);

	if (setinput) {
		this.controls.byName["tool-size"].input.value = size;
		this.controls.byName["tool-size"].integerOutput.textContent = (size==this.MIN_PATH_WIDTH) ? '1' : size; // display 1 instead of min path size fraction
	}
	if (this.lastMovePoint) {
		var context = this.effectsCanvasCtx;
		context.beginPath();
		context.arc(this.lastMovePoint[0], this.lastMovePoint[1], (this.current_size * this.local.zoom) / 2, 0, 2 * Math.PI, true);
		context.fillStyle = this.current_color.toRgbString();
		context.fill();
	}
};

Paint.prototype.setColor = function setColor (color) {
	if (this.brushing) return;
	console.log(this.brushing);
	this._changeColor(color);
	$(this.controls.byName["tool-color"].input).spectrum("set", this.current_color);
};

Paint.prototype.createControlArray = function createControlArray () {
	return [{
		name: "grab",
		type: "button",
		image: "images/icons/grab.png",
		title: "Change tool to grab",
		value: "grab",
		action: this.changeTool.bind(this)
	}, {
		name: "line",
		type: "button",
		image: "images/icons/line.png",
		title: "Change tool to line",
		value: "line",
		action: this.changeTool.bind(this)
	}, {
		name: "brush",
		type: "button",
		image: "images/icons/brush.png",
		title: "Change tool to brush",
		value: "brush",
		action: this.changeTool.bind(this)
	}, {
		name: "text",
		type: "button",
		image: "images/icons/text.png",
		title: "Change tool to text",
		value: "text",
		action: this.changeTool.bind(this)
	}, {
		name: "picker",
		type: "button",
		image: "images/icons/picker.png",
		title: "Change tool to picker",
		value: "picker",
		action: this.changeTool.bind(this)
	}, {
		name: "zoom",
		type: "button",
		image: "images/icons/zoom.png",
		title: "Change tool to zoom",
		value: "zoom",
		action: this.changeTool.bind(this)
	}, {
		name: "select",
		type: "button",
		image: "images/icons/select.png",
		title: "Change tool to select",
		value: "select",
		action: this.changeTool.bind(this)
	}, {
		name: "undo",
		type: "button",
		image: "images/icons/undo.png",
		title: "Undo drawing",
		action: this.undo.bind(this)
	}, /*{
		name: "block",
		type: "button",
		image: "images/icons/block.png",
		title: "Change tool to block",
		value: "block",
		action: this.changeTool.bind(this)
	},*/ {
		name: "tool-size",
		type: "integer",
		range: true,
		text: "Tool size",
		min: 1,
		max: this.defaultSettings.maxSize,
		value: 5,
		title: "Change the size of the tool",
		action: this.changeToolSize.bind(this)
	}, {
		name: "zoom-in",
		type: "button",
		image: "images/icons/zoomin.png",
		title: "Zoom in",
		value: 1.2,
		action: this.zoom.bind(this)
	}, {
		name: "zoom-reset",
		type: "button",
		image: "images/icons/zoomreset.png",
		title: "Reset zoom",
		value: 1,
		action: this.zoomAbsolute.bind(this)
	}, {
		name: "zoom-out",
		type: "button",
		image: "images/icons/zoomout.png",
		title: "Zoom out",
		value: 1 / 1.2,
		action: this.zoom.bind(this)
	}, {
		name: "tool-color",
		type: "color",
		text: "Tool color",
		value: "#FFFFFF",
		title: "Change the color of the tool",
		action: this._changeColor.bind(this)
	}/*, {
		name: "gradient",
		type: "gradient",
		action: this._changeGradient.bind(this)
	}*/];
};

Paint.prototype.zoom = function zoom (zoomFactor) {
	this.zoomAbsolute(this.public.zoom * zoomFactor);
};

Paint.prototype.zoomToPoint = function zoomToPoint(zoomFactor, pointX, pointY){
	if((zoomFactor>0.98)&&(zoomFactor<1.02)) zoomFactor=1;
	if (zoomFactor < 0.1) zoomFactor = 0.1;
	
	pointX = this.public.leftTopX + (pointX / this.public.zoom);
	pointY = this.public.leftTopY + (pointY / this.public.zoom);
	
	var ratioX = (pointX - this.public.leftTopX) / (this.canvasArray[0].width / this.public.zoom);
	var ratioY = (pointY - this.public.leftTopY) / (this.canvasArray[0].height / this.public.zoom);
	
	var newX = pointX - ((ratioX * this.canvasArray[0].width) / zoomFactor);
	var newY = pointY - ((ratioY * this.canvasArray[0].height) / zoomFactor);
	
	if(zoomFactor==1){
		newX=Math.round(newX)
		newY=Math.round(newY)
	}
	
	this.public.absoluteZoom(zoomFactor);
	this.background.absoluteZoom(zoomFactor);
	this.local.absoluteZoom(zoomFactor);

	this.goto(newX, newY);

	this.effectsCanvasCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
	this.redrawPaths();
	this.redrawFrames();
}

Paint.prototype.zoomAbsolute = function zoomAbsolute (zoomFactor) {
	if((zoomFactor>0.98)&&(zoomFactor<1.02)) zoomFactor=1;
	if (zoomFactor < 0.1) zoomFactor = 0.1;
	
	var currentMiddleX = this.public.leftTopX + this.canvasArray[0].width / this.public.zoom / 2;
	var currentMiddleY = this.public.leftTopY + this.canvasArray[0].height / this.public.zoom / 2;

	var newX = currentMiddleX - this.canvasArray[0].width / zoomFactor / 2;
	var newY = currentMiddleY - this.canvasArray[0].height / zoomFactor / 2;
	
	if(zoomFactor==1){
		newX=Math.round(newX)
		newY=Math.round(newY)
	}

	this.public.absoluteZoom(zoomFactor);
	this.background.absoluteZoom(zoomFactor);
	this.local.absoluteZoom(zoomFactor);

	this.goto(newX, newY);

	this.effectsCanvasCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
	this.redrawPaths();
	this.redrawFrames();
};

// Get the coordinates of the event relative to the upper left corner of the target element
Paint.prototype.getCoords = function getCoords (event) {
	// If there is no clientX/Y (meaning no mouse event) and there are no changed touches
	// meaning no touch event, then we can't get the coords relative to the target element
	// for this event
	if ((typeof event.clientX !== "number" && (!event.changedTouches || !event.changedTouches[0])) ||
		(typeof event.clientY !== "number" && (!event.changedTouches || !event.changedTouches[0])))
		return [0, 0];


	// Return the coordinates relative to the target element
	var clientX = (typeof event.clientX === 'number') ? event.clientX : event.changedTouches[0].clientX,
	    clientY = (typeof event.clientY === 'number') ? event.clientY : event.changedTouches[0].clientY,
	    target = event.target || document.elementFromPoint(clientX, clientY);

	if (this.boundingBoxList.indexOf(target) == -1)
		this.boundingBoxList.push(target);

	target.boundingBoxCache = target.boundingBoxCache || target.getBoundingClientRect();

	var relativeX = clientX - target.boundingBoxCache.left,
	    relativeY = clientY - target.boundingBoxCache.top;

	return [relativeX, relativeY];
};

// TODO: Fix rotation and mirror
Paint.prototype.getColorAt = function getColorAt (point) {
	for (var cKey = 0; cKey < this.canvasArray.length; cKey++) {
		this.tempPixelCtx.drawImage(this.canvasArray[cKey], point[0], point[1], 1, 1, 0, 0, 1, 1);
	}

	var pixel = this.tempPixelCtx.getImageData(0, 0, 1, 1).data;

	return tinycolor(this.rgbToHex(pixel[0], pixel[1], pixel[2]));
};

Paint.prototype.scaledCoords = function scaledCoords (point, event) {
	var newPoint = [point[0], point[1]];
	var target = event.target || document.elementFromPoint(point[0], point[1]);

	if (this.rotation !== 0 || this.scale[0] !== 1 || this.scale[1] !== 1) {
		newPoint[0] -= target.offsetWidth / 2;
		newPoint[1] -= target.offsetHeight / 2;

		newPoint[0] *= this.scale[0];
		newPoint[1] *= this.scale[1];

		var oldX = newPoint[0];
		var cos = Math.cos(-this.rotation * Math.PI / 180);
		var sin = Math.sin(-this.rotation * Math.PI / 180);
		newPoint[0] = newPoint[0] * cos - newPoint[1] * sin;
		newPoint[1] =        oldX * sin + newPoint[1] * cos;

		newPoint[0] += target.offsetWidth / 2;
		newPoint[1] += target.offsetHeight / 2;
	}

	return newPoint;
};

Paint.prototype.rgbToHex = function rgbToHex (r, g, b) {
	var hex = ((r << 16) | (g << 8) | b).toString(16);
	return "#" + ("000000" + hex).slice(-6);
};

Paint.prototype.tempPixelCtx = document.createElement("canvas").getContext("2d");

// Tools, called on events
Paint.prototype.tools = {
	zoom: function zoom (paint, event) {
		if (event == "remove") {
			delete paint.lastZoomPoint;
			delete paint.lastZoomPointDelta;
			paint.effectsCanvas.style.cursor = "";

			if (typeof paint.effectsCanvasCtx.setLineDash == "function")
				paint.effectsCanvasCtx.setLineDash([]);

			return;
		}

		paint.effectsCanvas.style.cursor = "zoom-in";

		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);
		var scaledCoords = paint.scaledCoords(targetCoords, event);
		
		if ((event.type == "mousedown" || event.type == "touchstart") && !paint.lastZoomPoint) {
			paint.lastTargetZoomPoint = targetCoords;
			paint.lastZoomPoint = scaledCoords;
			paint.lastZoomPointDelta = scaledCoords;
		}

		if (event.type == "mouseup" || event.type == "touchend") {
			delete paint.lastZoomPoint;
			delete paint.lastZoomPointDelta;
		}

		if ((event.type == "mousemove" || event.type == "touchmove") && paint.lastZoomPoint) {
			paint.effectsCanvasCtx.clearRect(0, 0, paint.effectsCanvas.width, paint.effectsCanvas.height);
			
			var x1 = scaledCoords[0];
			var y1 = scaledCoords[1];
			var x2 = paint.lastZoomPoint[0];
			var y2 = paint.lastZoomPoint[1];
			
			var x3 = paint.lastZoomPointDelta[0];
			var y3 = paint.lastZoomPointDelta[1];

			var minX = Math.min(x1, x2);
			var minY = Math.min(y1, y2);

			var width = x1 - x2;
			var height = Math.abs(y1 - y2);
			
			delta = targetCoords[0] - paint.lastTargetZoomPoint[0]; 
			zoomFactor = 1.1;
			if(delta < 0) { // zoom out
				paint.zoomToPoint(paint.public.zoom * ( 1 / zoomFactor ), x2, y2);
				
			} else if (delta > 0) {//zoom in
				paint.zoomToPoint(paint.public.zoom * ( zoomFactor ), x2, y2);
			}

			paint.lastZoomPointDelta = scaledCoords;
			paint.lastTargetZoomPoint = targetCoords; 
		}	
	},
	select: function select (paint, event) {
		if (event == "remove") {
			delete paint.lastSelectPoint;
			paint.effectsCanvas.style.cursor = "";

			if (typeof paint.effectsCanvasCtx.setLineDash == "function")
				paint.effectsCanvasCtx.setLineDash([]);

			return;
		}

		paint.effectsCanvas.style.cursor = "cell";

		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);
		var scaledCoords = paint.scaledCoords(targetCoords, event);

		if ((event.type == "mousedown" || event.type == "touchstart") && !paint.lastSelectPoint) {
			paint.lastSelectPoint = scaledCoords;
		}

		if (event.type == "mouseup" || event.type == "touchend") {
			// If mouseup is on the same point as mousedown we switch behaviour by making
			// a box between two clicks instead of dragging the box around
			if (paint.lastSelectPoint[0] == scaledCoords[0] && paint.lastSelectPoint[1] == scaledCoords[1]) {
				return;
			}

			var x1 = Math.round(paint.local.leftTopX + (paint.lastSelectPoint[0] / paint.local.zoom));
			var y1 = Math.round(paint.local.leftTopY + (paint.lastSelectPoint[1] / paint.local.zoom));

			var x2 = Math.round(paint.local.leftTopX + (scaledCoords[0] / paint.local.zoom));
			var y2 = Math.round(paint.local.leftTopY + (scaledCoords[1] / paint.local.zoom));

			paint.dispatchEvent({
				type: "select",
				from: [x1, y1],
				to: [x2, y2]
			});

			delete paint.lastSelectPoint;
			paint.effectsCanvasCtx.clearRect(0, 0, paint.effectsCanvas.width, paint.effectsCanvas.height);
		}

		if ((event.type == "mousemove" || event.type == "touchmove") && paint.lastSelectPoint) {
			paint.effectsCanvasCtx.clearRect(0, 0, paint.effectsCanvas.width, paint.effectsCanvas.height);

			var x1 = scaledCoords[0];
			var y1 = scaledCoords[1];
			var x2 = paint.lastSelectPoint[0];
			var y2 = paint.lastSelectPoint[1];

			var minX = Math.min(x1, x2);
			var minY = Math.min(y1, y2);

			var width = Math.abs(x1 - x2);
			var height = Math.abs(y1 - y2);

			var context = paint.effectsCanvasCtx;
			context.beginPath();

			if (typeof context.setLineDash == "function")
				context.setLineDash([4]);

			context.rect(minX, minY, width, height);
			context.lineWidth = 2;
			context.strokeStyle = "darkgray";
			context.stroke();
		}	
	},
	grab: function grab (paint, event) {
		// Tool canceled or deselected
		if (event == "remove" || event.type == "mouseup" || event.type == "touchend" || event.type === 'mouseleave') {
			delete paint.lastGrabCoords;
			paint.effectsCanvas.style.cursor = "";
			return;
		}

		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);
		var scaledCoords = paint.scaledCoords(targetCoords, event);

		// First time we grab?
		if (!paint.lastGrabCoords) {
			// If this is just a mousemove we are just moving
			// our mouse without holding the button down
			if (event.type == "mousedown" || event.type == "touchstart") {
				paint.lastGrabCoords = scaledCoords;
				paint.effectsCanvas.style.cursor = "move";
			}
		}

		if ((event.type == "mousemove" || event.type == "touchmove") && paint.lastGrabCoords) {
			// How much should the drawings be moved
			var relativeMotionX = paint.lastGrabCoords[0] - scaledCoords[0],
			    relativeMotionY = paint.lastGrabCoords[1] - scaledCoords[1];

			paint.goto(paint.local.leftTopX + (relativeMotionX / paint.local.zoom), paint.local.leftTopY + (relativeMotionY / paint.local.zoom));

			// Update last grab position
			paint.lastGrabCoords = scaledCoords;
		}		
	},
	line: function line (paint, event) {
		if (event == "remove") {
			delete paint.lastLinePoint;
			paint.effectsCanvas.style.cursor = "";
			return;
		}

		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);
		var scaledCoords = paint.scaledCoords(targetCoords, event);

		if ((event.type == "mousedown" || event.type == "touchstart") && !paint.lastLinePoint) {
			paint.lastLinePoint = scaledCoords;
		}

		if (event.type == "mouseup" || event.type == "touchend") {
			// If mouseup is on the same point as mousedown we switch behaviour by making
			// a line between two clicks instead of dragging
			if (paint.lastLinePoint[0] == scaledCoords[0] && paint.lastLinePoint[1] == scaledCoords[1]) {
				return;
			}

			paint.addUserDrawing({
				type: "line",
				x: Math.round((paint.local.leftTopX + (paint.lastLinePoint[0] / paint.local.zoom)) * paint.PATH_PRECISION)/ paint.PATH_PRECISION,
				y: Math.round((paint.local.leftTopY + (paint.lastLinePoint[1] / paint.local.zoom)) * paint.PATH_PRECISION) / paint.PATH_PRECISION,
				x1: Math.round((paint.local.leftTopX + (scaledCoords[0] / paint.local.zoom)) * paint.PATH_PRECISION) / paint.PATH_PRECISION,
				y1: Math.round((paint.local.leftTopY + (scaledCoords[1] / paint.local.zoom)) * paint.PATH_PRECISION) / paint.PATH_PRECISION,
				size: paint.current_size,
				color: paint.current_color
			});

			delete paint.lastLinePoint;
			paint.effectsCanvasCtx.clearRect(0, 0, paint.effectsCanvas.width, paint.effectsCanvas.height);
		}

		if ((event.type == "mousemove" || event.type == "touchmove") && paint.lastLinePoint) {
			paint.effectsCanvasCtx.clearRect(0, 0, paint.effectsCanvas.width, paint.effectsCanvas.height);

			// TODO refactor this to use drawFunctions
			var context = paint.effectsCanvasCtx;
			context.beginPath();
			context.arc(paint.lastLinePoint[0], paint.lastLinePoint[1], (paint.current_size * paint.local.zoom) / 2, 0, 2 * Math.PI, true);
			context.fillStyle = paint.current_color.toRgbString();
			context.fill();

			context.beginPath();
			context.moveTo(paint.lastLinePoint[0], paint.lastLinePoint[1]);
			context.lineTo(scaledCoords[0], scaledCoords[1]);			
			context.strokeStyle = paint.current_color.toRgbString();
			context.lineWidth = paint.current_size * paint.local.zoom ;
			context.stroke();

			context.beginPath();
			context.arc(scaledCoords[0], scaledCoords[1], (paint.current_size * paint.local.zoom) / 2, 0, 2 * Math.PI, true);
			context.fillStyle = paint.current_color.toRgbString();
			context.fill();			
		}
	},
	brush: function brush (paint, event, type) {
		if (event == "remove") {
			delete paint.lastMovePoint;
			delete paint.lockcolor;
			delete paint.brushing;
			return;
		}

		paint.lastMovePoint = paint.lastMovePoint || [0, 0];

		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);
		var scaledCoords = paint.scaledCoords(targetCoords, event);

		if (event.type == "mousedown" || event.type == "touchstart") {
			paint.brushing = true;
			paint.addUserPath();
			paint.addUserPathPoint([Math.round((paint.local.leftTopX + (scaledCoords[0] / paint.local.zoom)) * paint.PATH_PRECISION) / paint.PATH_PRECISION,
			                        Math.round((paint.local.leftTopY + (scaledCoords[1] / paint.local.zoom)) * paint.PATH_PRECISION) / paint.PATH_PRECISION]);

			// Clear the previous mouse dot
			paint.effectsCanvasCtx.clearRect(paint.lastMovePoint[0] - paint.current_size * paint.local.zoom * 2, paint.lastMovePoint[1] - paint.current_size * paint.local.zoom * 2, paint.current_size * paint.local.zoom * 4, paint.current_size * paint.local.zoom * 4);

		}

		if (event.type == "mouseup" || event.type == "touchend" || event.type == "mouseleave") {
			paint.endUserPath();
			paint.brushing = false;
		}

		if (event.type == "mousemove" || event.type == "touchmove") {
			// If we are brushing we don't need to draw a preview
			if (!this.brushing) {
				// Clear the previous mouse dot
				paint.effectsCanvasCtx.clearRect(paint.lastMovePoint[0] - paint.current_size * paint.local.zoom * 2, paint.lastMovePoint[1] - paint.current_size * paint.local.zoom * 2, paint.current_size * paint.local.zoom * 4, paint.current_size * paint.local.zoom * 4);

				// Draw the current mouse position
				var context = paint.effectsCanvasCtx;
				context.beginPath();
				context.arc(scaledCoords[0], scaledCoords[1], (paint.current_size * paint.local.zoom) / 2, 0, 2 * Math.PI, true);

				if (paint.current_color.type == "gradient") {
					if (!paint.current_color[0]) {
						context.fillStyle = "black";
					} else {
						context.fillStyle = paint.current_color[0].color.toRgbString();	
					}
				} else {
					context.fillStyle = paint.current_color.toRgbString();
				}

				context.fill();
				
				// Save the last move point for efficient clearing
				paint.lastMovePoint[0] = scaledCoords[0];
				paint.lastMovePoint[1] = scaledCoords[1];
			}


			// If the last brush point is set we are currently drawing
			if (paint.brushing) {
				paint.addUserPathPoint([Math.round((paint.local.leftTopX + (scaledCoords[0] / paint.local.zoom)) * paint.PATH_PRECISION) / paint.PATH_PRECISION,
			                            Math.round((paint.local.leftTopY + (scaledCoords[1] / paint.local.zoom)) * paint.PATH_PRECISION) / paint.PATH_PRECISION]);
			}
		}
	},
	picker: function picker (paint, event) {
		if (event == "remove") {
			delete paint.picking;
			paint.effectsCanvas.style.cursor = "";
			return;
		}
		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);

		if ((event.type == "mousedown" || event.type == "touchstart") && !paint.picking && !paint.rightClick) {
			paint.picking = true;
			paint.setColor(paint.getColorAt(targetCoords).setAlpha(paint.current_color.getAlpha()));
			paint.effectsCanvas.style.cursor = "crosshair";
		}

		if (event.type == "mouseup" || event.type == "touchend") {
			delete paint.picking;
			paint.effectsCanvas.style.cursor = "";
			this.change_size(paint,"remove");
		}

		if (event.type == "mousemove" || event.type == "touchmove") {
			if (paint.picking)
				paint.setColor(paint.getColorAt(targetCoords).setAlpha(paint.current_color.getAlpha()));
		}
	},
	block: function block (paint, event) {
		this.brush(paint, event, "block");
	},
	text: function text (paint, event) {
		if (event == "remove") {
			// Remove lastmove data
			delete paint.lastMovePoint;
			delete paint.lastToolText;

			// Remove the text tool from dom and paint object
			paint.textToolInput && paint.container.removeChild(paint.textToolInput);
			delete paint.textToolInput;
			return;
		}

		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);
		var scaledCoords = paint.scaledCoords(targetCoords, event);

		// Create an input for the text if one doesn't exist
		if (!paint.textToolInput) {
			paint.textToolInput = document.createElement("input");

			paint.textToolInput.className = "paint-texttool";
			paint.textToolInput.placeholder = "Type some text";
			
			paint.container.appendChild(paint.textToolInput);
			paint.textToolInput.addEventListener("input", function () {
				this.exectool("redraw");
			}.bind(paint));
		}

		paint.textToolInput.focus();

		if ((event.type == "mouseup" || event.type == "touchend") && paint.textToolInput.value) {
			paint.addUserDrawing({
				type: "text",
				text: paint.textToolInput.value.slice(0, 256) || "",
				x: Math.round(paint.local.leftTopX + (scaledCoords[0] / paint.local.zoom)),
				y: Math.round(paint.local.leftTopY + (scaledCoords[1] / paint.local.zoom)),
				size: paint.current_size,
				color: paint.current_color
			});
			paint.textToolInput.value = "";
		}

		if (event.type == "mousemove" || event.type == "touchmove") {
			paint.lastMovePoint = paint.lastMovePoint || [0, 0];

			paint.effectsCanvasCtx.font = paint.current_size * paint.local.zoom + "px Verdana, Geneva, sans-serif";

			// Remove the old text and draw the new one (use half height margin)
			paint.effectsCanvasCtx.clearRect(paint.lastMovePoint[0],
			                                 paint.lastMovePoint[1] - (paint.current_size * paint.local.zoom * 1.5),
			                                 paint.effectsCanvasCtx.measureText(paint.lastToolText).width,
			                                 paint.current_size * paint.local.zoom * 2);

			paint.effectsCanvasCtx.fillStyle = paint.current_color.toRgbString();
			paint.effectsCanvasCtx.fillText(paint.textToolInput.value.slice(0, 256), scaledCoords[0], scaledCoords[1]);

			paint.lastToolText = paint.textToolInput.value.slice(0, 256);
			paint.lastMovePoint = scaledCoords;
		}

		if (event == "redraw") {
			paint.effectsCanvasCtx.font = paint.current_size * paint.local.zoom + "px Verdana, Geneva, sans-serif";
			// Remove the old text and draw the new one (use half height margin)
			paint.effectsCanvasCtx.clearRect(paint.lastMovePoint[0],
			                                 paint.lastMovePoint[1] - (paint.current_size * paint.local.zoom * 1.5),
			                                 paint.effectsCanvasCtx.measureText(paint.lastToolText).width,
			                                 paint.current_size * paint.local.zoom * 2);

			paint.effectsCanvasCtx.fillStyle = paint.current_color.toRgbString();
			paint.effectsCanvasCtx.fillText(paint.textToolInput.value.slice(0, 256), paint.lastMovePoint[0], paint.lastMovePoint[1]);
			paint.lastToolText = paint.textToolInput.value.slice(0, 256);
		}
	},
	change_size: function change_size (paint, event) {
		if (event == "remove") {
			delete paint.lastChangeSizePoint;
			delete paint.lastChangeSizePointAlt;
			return;
		}
		
		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);
		var scaledCoords = paint.scaledCoords(targetCoords, event);
		
		if ((event.type == "mousedown" || event.type == "touchstart") && !paint.lastChangeSizePoint && !paint.leftClick) {
			paint.lastTargetZoomPoint = targetCoords;
			paint.lastChangeSizePoint = scaledCoords;
			paint.lastChangeSizePointAlt = scaledCoords;
		}
		
		if ((event.type == "mousemove" || event.type == "touchmove") && paint.lastChangeSizePoint) {
			var x1 = scaledCoords[0];
			var y1 = scaledCoords[1];

			var x3 = paint.lastChangeSizePointAlt[0];
			var y3 = paint.lastChangeSizePointAlt[1];
			
			var delta = targetCoords[0] - paint.lastTargetZoomPoint[0];
			var change = 1;
			
			if (delta < 0) { // mouse move left
				paint.current_size -= change;
			} else if (delta > 0) {
				paint.current_size += change;
			}
			paint.changeToolSize(paint.current_size, true);
			paint.lastChangeSizePointAlt = scaledCoords;
			paint.lastTargetZoomPoint = targetCoords;
			
			// Clear the previous mouse dot
			paint.effectsCanvasCtx.clearRect(0, 0, paint.effectsCanvas.width, paint.effectsCanvas.height);
            
			// Draw the current mouse position
			var context = paint.effectsCanvasCtx;
			context.beginPath();
			context.arc(paint.lastChangeSizePoint[0], paint.lastChangeSizePoint[1], (paint.current_size * paint.local.zoom) / 2, 0, 2 * Math.PI, true);
            
			if (paint.current_color.type == "gradient") {
				if (!paint.current_color[0]) {
					context.fillStyle = "black";
				} else {
					context.fillStyle = paint.current_color[0].color.toRgbString();	
				}
			} else {
				context.fillStyle = paint.current_color.toRgbString();
			}
            
			context.fill();
		}
	},
	change_rotation: function change_rotation (paint, event) {
		if (event == "remove") {
			delete paint.lastChangeRotationPoint;
			delete paint.RotationPointOnRight;
			return;
		}
		
		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);
		var scaledCoords = paint.scaledCoords(targetCoords, event);
		
		if ((event.type == "mousedown" || event.type == "touchstart") && !paint.lastChangeRotationPoint && paint.leftClick) {
			paint.lastChangeRotationPoint = targetCoords;
		}
		
		if ((event.type == "mousedown" || event.type == "touchstart")){
			if(targetCoords[0] > paint.canvasArray[0].width / 2)
				paint.RotationPointOnRight = true;
			else 
				paint.RotationPointOnRight = false;
			var x1 = targetCoords[0];
			var y1 = targetCoords[1];
			var p1 = {
				x: x1,
				y: y1
			};

			var p2 = {
				x: paint.canvasArray[0].width / 2,
				y: paint.canvasArray[0].height / 2
			};
			
			if(paint.RotationPointOnRight){
				p3 = p1;
				p1 = p2;
				p2 = p3;
			}
			paint.anglething =  Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
			paint.anglething -= anondraw.collab.paint.rotation;
		}
		
		if ((event.type == "mousemove" || event.type == "touchmove") && paint.lastChangeRotationPoint) {
			var x1 = targetCoords[0];
			var y1 = targetCoords[1];

			var x3 = paint.lastChangeRotationPoint[0];
			var y3 = paint.lastChangeRotationPoint[1];
			
			var p1 = {
				x: x1,
				y: y1
			};

			var p2 = {
				x: paint.canvasArray[0].width / 2,
				y: paint.canvasArray[0].height / 2
			};
			
			if(paint.RotationPointOnRight){
				p3 = p1;
				p1 = p2;
				p2 = p3;
			}

			var angleDeg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
			console.log(angleDeg, paint.anglething);
			angleDeg = angleDeg - paint.anglething;
			console.log("new angle",angleDeg);
			
			paint.setRotation(angleDeg * paint.scale[0] * paint.scale[1]);

			paint.lastChangeRotationPoint = targetCoords;
		}
	}
};

// Drawfunctions
// this = current paint

Paint.prototype.drawFunctions = {
	brush: function (context, drawing, tiledCanvas) {
		context.beginPath();
		context.arc(drawing.x, drawing.y, drawing.size, 0, 2 * Math.PI, true);
		context.fillStyle = drawing.color.toRgbString();
		context.fill();

		if (tiledCanvas) {
			tiledCanvas.drawingRegion(drawing.x, drawing.y, drawing.x, drawing.y, drawing.size);
			tiledCanvas.executeNoRedraw();
		}
	},
	block: function (context, drawing, tiledCanvas) {
		context.fillStyle = drawing.color.toRgbString();
		context.fillRect(drawing.x, drawing.y, drawing.size, drawing.size);

		if (tiledCanvas) {
			tiledCanvas.drawingRegion(drawing.x, drawing.y, drawing.x, drawing.y, drawing.size);
			tiledCanvas.executeNoRedraw();
		}
	},
	line: function (context, drawing, tiledCanvas) {
		context.beginPath();

		context.moveTo(drawing.x, drawing.y + this.FIX_CANVAS_PIXEL_SIZE);
		context.lineTo(drawing.x1, drawing.y1 + this.FIX_CANVAS_PIXEL_SIZE);
		
		context.strokeStyle = drawing.color.toRgbString();
		context.lineWidth = drawing.size;

		context.lineCap = "round";

		context.stroke();
		
		if (tiledCanvas) {
			tiledCanvas.drawingRegion(drawing.x, drawing.y, drawing.x1, drawing.y1, drawing.size);
			tiledCanvas.executeNoRedraw();
		}
	},
	path: function (context, drawing, tiledCanvas) {
		this.drawPath(drawing, context, tiledCanvas);
	},
	text: function (context, drawing, tiledCanvas) {
		context.font = drawing.size + "px Verdana, Geneva, sans-serif";
		context.fillStyle = drawing.color.toRgbString();

		context.fillText(drawing.text, drawing.x, drawing.y);

		if (tiledCanvas) {
			// Context can't be used because it's a tiledCanvas context
			// and that doesnt have a meastureText function that actually returns
			// valid data, so we need to create a hidden context
			var hiddenContext = document.createElement("canvas").getContext("2d");
			hiddenContext.font = drawing.size + "pt Verdana, Geneva, sans-serif";
			var textWidth = hiddenContext.measureText(drawing.text).width;

			tiledCanvas.drawingRegion(drawing.x, drawing.y - drawing.size, drawing.x + textWidth, drawing.y, drawing.size);
			tiledCanvas.executeNoRedraw();
		}
	}
};

Paint.prototype.utils = {
	copy: function (object) {
		// Returns a deep copy of the object
		var copied_object = {};
		for (var key in object) {
			if (typeof object[key] == "object") {
				copied_object[key] = this.copy(object[key]);
			} else {
				copied_object[key] = object[key];
			}
		}
		return copied_object;
	},
	merge: function (targetobject, object) {
		// All undefined keys from targetobject will be filled
		// by those of object (goes deep)
		if (typeof targetobject != "object") {
			targetobject = {};
		}

		for (var key in object) {
			if (typeof object[key] == "object") {
				targetobject[key] = this.merge(targetobject[key], object[key]);
			} else if (typeof targetobject[key] == "undefined") {
				targetobject[key] = object[key];
			}
		}

		return targetobject;
	},
	sqDistance: function sqDistance (point1, point2) {
		var xDist = point1[0] - point2[0];
		var yDist = point1[1] - point2[1];
		return xDist * xDist + yDist * yDist;
	}
};

/**
 * Event dispatcher
 * License mit
 * https://github.com/mrdoob/eventdispatcher.js
 * @author mrdoob / http://mrdoob.com/
 */

var EventDispatcher = function () {}

EventDispatcher.prototype = {

	constructor: EventDispatcher,

	apply: function ( object ) {

		object.addEventListener = EventDispatcher.prototype.addEventListener;
		object.hasEventListener = EventDispatcher.prototype.hasEventListener;
		object.removeEventListener = EventDispatcher.prototype.removeEventListener;
		object.dispatchEvent = EventDispatcher.prototype.dispatchEvent;

	},

	addEventListener: function ( type, listener ) {

		if ( this._listeners === undefined ) this._listeners = {};

		var listeners = this._listeners;

		if ( listeners[ type ] === undefined ) {

			listeners[ type ] = [];

		}

		if ( listeners[ type ].indexOf( listener ) === - 1 ) {

			listeners[ type ].push( listener );

		}

	},

	hasEventListener: function ( type, listener ) {

		if ( this._listeners === undefined ) return false;

		var listeners = this._listeners;

		if ( listeners[ type ] !== undefined && listeners[ type ].indexOf( listener ) !== - 1 ) {

			return true;

		}

		return false;

	},

	removeEventListener: function ( type, listener ) {

		if ( this._listeners === undefined ) return;

		var listeners = this._listeners;
		var listenerArray = listeners[ type ];

		if ( listenerArray !== undefined ) {

			var index = listenerArray.indexOf( listener );

			if ( index !== - 1 ) {

				listenerArray.splice( index, 1 );

			}

		}

	},

	dispatchEvent: function ( event ) {
			
		if ( this._listeners === undefined ) return;

		var listeners = this._listeners;
		var listenerArray = listeners[ event.type ];

		if ( listenerArray !== undefined ) {

			event.target = this;

			var array = [];
			var length = listenerArray.length;

			for ( var i = 0; i < length; i ++ ) {

				array[ i ] = listenerArray[ i ];

			}

			for ( var i = 0; i < length; i ++ ) {

				array[ i ].call( this, event );

			}

		}

	}

};

EventDispatcher.prototype.apply(Paint.prototype);

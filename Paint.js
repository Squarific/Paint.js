function Paint (container, settings) {
	this.eventHandlers = {};
	this.settings = this.utils.merge(this.utils.copy(settings), this.defaultSettings);

	this.container = container;

	this.addCanvas(container);
	this.resize();

	this.controlContainer = container.appendChild(document.createElement("div"));
	this.controlContainer.className = "control-container";
	this.controls = new Controls(this.controlContainer, this.createControlArray());
	this.toolButtons = ["grab", "line", "brush", "picker"];

	// Set tool values
	this.changeTool("brush");
	this.changeColor(new tinycolor());
	this.changeToolSize(5);

	$(this.controls.byName["tool-color"].input).spectrum("set", this.current_color);

	this.localDrawings = [];
	this.paths = {};
	this.localUserPaths = [];

	window.addEventListener("resize", this.resize.bind(this));
}

Paint.prototype.defaultSettings = {
	maxSize: 50,
	maxLineLength: 200
};

Paint.prototype.addCanvas = function addCanvas (container) {
	var publicC = container.appendChild(this.createCanvas("public"));
	var localC  = container.appendChild(this.createCanvas("local"));
	var effectC = container.appendChild(this.createCanvas("effect"));

	this.public = new TiledCanvas(publicC);
	this.local = new TiledCanvas(localC);

	this.effectsCanvas = effectC;
	this.effectsCanvasCtx = effectC.getContext("2d");

	this.publicCtx = publicC.getContext("2d");
	this.localCtx = localC.getContext("2d");

	effectC.addEventListener("mousedown", this.exectool.bind(this));
	effectC.addEventListener("mousemove", this.exectool.bind(this));
	effectC.addEventListener("mouseup", this.exectool.bind(this));
	effectC.addEventListener("mouseleave", this.exectool.bind(this));

	effectC.addEventListener("touchstart", this.exectool.bind(this));
	effectC.addEventListener("touchmove", this.exectool.bind(this));
	effectC.addEventListener("touchend", this.exectool.bind(this));

	this.canvasArray = [publicC, localC, effectC];
	this.lastCanvas = localC;

	this.pathCanvas = this.newCanvasOnTop("paths");
	this.pathContext = this.pathCanvas.getContext("2d");
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
	this.public.chunks = {};
	this.local.chunks = {};
	this.paths = {};
	this.localUserPaths = [];

	this.goto(0, 0);

	this.public.redraw();
	this.local.redraw();
};

Paint.prototype.goto = function goto (worldX, worldY) {
	// Move both local and public tiledcanvas and set all canvas leftTopX/Y properties
	this.local.goto(worldX, worldY);
	this.public.goto(worldX, worldY);

	for (var k = 0; k < this.canvasArray.length; k++) {
		this.canvasArray[k].leftTopX = this.public.leftTopX;
		this.canvasArray[k].leftTopY = this.public.leftTopY;
	}

	this.redrawPaths();
};

Paint.prototype.createCanvas = function createCanvas (name) {
	var canvas = document.createElement("canvas");
	canvas.className = "paint-canvas paint-canvas-" + name;
	return canvas;
};

// Invalidate the canvas size
Paint.prototype.resize = function () {
	for (var cKey = 0; cKey < this.canvasArray.length; cKey++) {
		this.canvasArray[cKey].width = this.canvasArray[cKey].offsetWidth;
		this.canvasArray[cKey].height = this.canvasArray[cKey].offsetHeight;
	}
	this.public.redraw();
	this.local.redraw();
	this.redrawPaths();
};

Paint.prototype.redrawLocalDrawings = function redrawLocalDrawings () {
	// Redraw the locals in the current loop
	this.redrawLocalsNeeded = true;

	// Only redraw every so often and not every change of the locals
	if (!this.drawDrawingTimeout)
		this.drawDrawingTimeout = setTimeout(this.redrawTimeout.bind(this), 30);
};

Paint.prototype.redrawTimeout = function redrawTimeout () {
	// Redraw in an animationframe
	requestAnimationFrame(this.redrawLoop.bind(this));
};

Paint.prototype.redrawLoop = function redrawLoop () {
	// Redraw after we ADD (!) to one of the layers
	// or if we ADD/REMOVE from the local layer
	// If you remove from another layer and call the redrawloop transparency issues may arrise
	for (var layer in this.redrawLayers) {
		this[layer].redraw();
	}

	if (this.redrawLocalsNeeded)
		this.redrawLocals();
	
	delete this.drawDrawingTimeout;
	delete this.redrawLocalsNeeded;
};

// Shedule for the paths to be redrawn in the next frame
Paint.prototype.redrawPaths = function redrawPaths () {
	if (this.redrawPathsTimeout) return;
	this.redrawPathsTimeout = requestAnimationFrame(this._redrawPaths.bind(this));
};

Paint.prototype._redrawPaths = function _redrawPaths () {
	this.pathContext.clearRect(0, 0, this.pathContext.canvas.width, this.pathContext.canvas.height);

	for (var pathId in this.paths) {
		this.drawPath(this.paths[pathId]);
	}

	for (var pathId = 0; pathId < this.localUserPaths.length; pathId++) {
		this.drawPath(this.localUserPaths[pathId]);
	}

	delete this.redrawPathsTimeout;
};

Paint.prototype.drawPathTiledCanvas = function drawPathTiledCanvas (path, ctx, tiledCanvas) {
	var minX = path.points[0][0],
	    minY = path.points[0][1],
	    maxX = path.points[0][0],
	    maxY = path.points[0][1];

	// Start on the first point
	ctx.beginPath();
	ctx.moveTo(path.points[0][0], path.points[0][1]);

	// Connect a line between all points
	for (var pointId = 1; pointId < path.points.length; pointId++) {
		ctx.lineTo(path.points[pointId][0], path.points[pointId][1]);

		minX = Math.min(path.points[pointId][0], minX);
		minY = Math.min(path.points[pointId][1], minY);
		maxX = Math.max(path.points[pointId][0], maxX);
		maxY = Math.max(path.points[pointId][1], maxY);
	}

	ctx.strokeStyle = path.color.toRgbString();
	ctx.lineWidth = path.size * 2;

	ctx.lineJoin = "round";
	ctx.lineCap = "round";

	ctx.stroke();
	tiledCanvas.drawingRegion(minX, minY, maxX, maxY, path.size);
	tiledCanvas.execute();
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
	ctx.moveTo(x * this.public.zoom, y * this.public.zoom);

	// Connect a line between all points
	for (var pointId = 1; pointId < path.points.length; pointId++) {
		var x = path.points[pointId][0] - this.public.leftTopX,
		    y = path.points[pointId][1] - this.public.leftTopY;
		ctx.lineTo(x * this.public.zoom, y * this.public.zoom);
	}

	ctx.strokeStyle = path.color.toRgbString();
	ctx.lineWidth = path.size * 2;

	ctx.lineJoin = "round";
	ctx.lineCap = "round";

	ctx.stroke();
};

Paint.prototype.redrawLocals = function redrawLocals (noclear) {
	// Force the redrawing of locals NOW

	// TODO: Only clear the parts that were removed

	this.local.clearAll();
	this.localDrawings.forEach(this.drawDrawing.bind(this, "local"));

	this.local.redraw();
}

Paint.prototype.removeLocalDrawing = function removeLocalDrawing (drawing) {
	var index = this.localDrawings.indexOf(drawing);
	this.localDrawings.splice(index, 1);
	this.redrawLocalDrawings();
};

Paint.prototype.addPublicDrawing = function addPublicDrawing (drawing) {
	this.drawDrawing("public", drawing);
};

Paint.prototype.addPath = function addPath (id, props) {
	this.paths[id] = props;
	this.paths[id].points = this.paths[id].points || [];
	this.redrawPaths();
};

Paint.prototype.addPathPoint = function addPathPoint (id, point) {
	if (!this.paths[id]) {
		console.error("Path ", id, " not known. Can't add point.");
		return;
	}

	this.paths[id].points.push(point);
	this.redrawPaths();
};

// Draw the given path on the public layer and remove it
Paint.prototype.finalizePath = function finalizePath (id) {
	if (!this.paths[id]) {
		console.error("Path ", id, " not known. Can't finalize.");
		return;
	}

	this.drawPath(this.paths[id], this.publicCtx, this.public);
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
		point: point
	});

	this.redrawPaths();
};

Paint.prototype.endUserPath = function endUserPath () {
	var lastPath = this.localUserPaths[this.localUserPaths.length - 1];

	this.dispatchEvent({
		type: "enduserpath",
		removePath: this.removeUserPath.bind(this, lastPath)
	});
};

Paint.prototype.removeUserPath = function removeUserPath (path) {
	for (var k = 0; k < this.localUserPaths.length; k++) {
		if (this.localUserPaths[k] == path) {
			this.localUserPaths.splice(k, 1);
			this.redrawPaths();
			return true;
		}
	}

	return false;
};

// Put the drawings on the given layer ('public', 'local', 'effects')
Paint.prototype.drawDrawings = function drawDrawings (layer, drawings) {
	for (var dKey = 0; dKey < drawings.length; dKey++) {
		this.drawFunctions[drawings[dKey].type].call(this, this[layer].context, drawings[dKey], this[layer]);
	}
	this[layer].redraw(true);
};

// Put the drawing on the given layer ('public', 'local', 'effects')
Paint.prototype.drawDrawing = function drawDrawing (layer, drawing) {
	this.drawFunctions[drawing.type](this[layer].context, drawing, this[layer]);

	this.redrawLayers = this.redrawLayers || {};
	this.redrawLayers[layer] = true;

	if (!this.drawDrawingTimeout)
		this.drawDrawingTimeout = setTimeout(this.redrawLoop.bind(this), 30);
};

// User interaction on the canvas
Paint.prototype.exectool = function exectool (event) {
	// Don't do the default stuff
	if (event && typeof event.preventDefault == "function")
	event.preventDefault();

	if (typeof this.tools[this.current_tool] == "function") {
		this.tools[this.current_tool](this, event);
	}
};

Paint.prototype.changeTool = function changeTool (tool) {
	this.exectool("remove");
	this.current_tool = tool;
	this.effectsCanvasCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);

	for (var k = 0; k < this.toolButtons.length; k++)
		this.controls.byName[this.toolButtons[k]].input.classList.remove("paint-selected-tool");

	this.controls.byName[tool].input.classList.add("paint-selected-tool");
};

Paint.prototype.changeColor = function changeColor (color) {
	this.current_color = tinycolor(color);
	this.effectsCanvasCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
};

Paint.prototype.changeToolSize = function changeToolSize (size) {
	if (size > this.settings.maxSize) size = this.settings.maxSize;
	if (size < 0) size = 0;
	this.current_size = parseInt(size);
	this.effectsCanvasCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
};

Paint.prototype.setColor = function setColor (color) {
	this.changeColor(color);
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
		name: "picker",
		type: "button",
		image: "images/icons/picker.png",
		title: "Change tool to picker",
		value: "picker",
		action: this.changeTool.bind(this)
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
		text: "Tool size",
		min: 1,
		max: 50,
		value: 5,
		title: "Change the size of the tool",
		action: this.changeToolSize.bind(this)
	}, {
		name: "zoom-in",
		type: "button",
		image: "images/icons/zoomin.png",
		title: "Zoom in",
		value: 2,
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
		value: 0.5,
		action: this.zoom.bind(this)
	}, {
		name: "tool-color",
		type: "color",
		text: "Tool color",
		value: "#FFFFFF",
		title: "Change the color of the tool",
		action: this.changeColor.bind(this)
	}];
};

Paint.prototype.zoom = function zoom (zoomFactor) {
	this.public.relativeZoom(zoomFactor);
	this.local.relativeZoom(zoomFactor);
	this.effectsCanvasCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
	this.redrawPaths();
};

Paint.prototype.zoomAbsolute = function zoomAbsolute (zoomFactor) {
	this.public.absoluteZoom(zoomFactor);
	this.local.absoluteZoom(zoomFactor);
	this.effectsCanvasCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
	this.redrawPaths();
};

Paint.prototype.getCoords = function getCoords (event) {
	// Return the coordinates relative to the target element
	var clientX = (typeof event.clientX === 'number') ? event.clientX : event.changedTouches[0].clientX,
		clientY = (typeof event.clientY === 'number') ? event.clientY : event.changedTouches[0].clientY,
		target = event.target || document.elementFromPoint(clientX, clientY),
		boundingBox = target.getBoundingClientRect(),
		relativeX = clientX - boundingBox.left,
		relativeY = clientY - boundingBox.top;
	return [relativeX, relativeY];
};

Paint.prototype.getColorAt = function getColorAt (point) {
	for (var cKey = 0; cKey < this.canvasArray.length; cKey++) {
		this.tempPixelCtx.drawImage(this.canvasArray[cKey], point[0], point[1], 1, 1, 0, 0, 1, 1);
	}

	var pixel = this.tempPixelCtx.getImageData(0, 0, 1, 1).data;

	return tinycolor(this.rgbToHex(pixel[0], pixel[1], pixel[2]));
};

Paint.prototype.rgbToHex = function rgbToHex (r, g, b) {
	var hex = ((r << 16) | (g << 8) | b).toString(16);
	return "#" + ("000000" + hex).slice(-6);
};

Paint.prototype.tempPixelCtx = document.createElement("canvas").getContext("2d");

// Tools, called on events
Paint.prototype.tools = {
	grab: function grab (paint, event) {
		// Tool canceled or deselected
		if (event == "remove" || event.type == "mouseup" || event.type == "touchend" || event.type === 'mouseleave') {
			delete paint.lastGrabCoords;
			paint.effectsCanvas.style.cursor = "";
			return;
		}

		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);

		// First time we grab?
		if (!paint.lastGrabCoords) {
			// If this is just a mousemove we are just moving
			// our mouse without holding the button down
			if (event.type == "mousemove") return;
			paint.lastGrabCoords = targetCoords;
			paint.effectsCanvas.style.cursor = "move";
			return;
		}

		// How much should the drawings be moved
		var relativeMotionX = paint.lastGrabCoords[0] - targetCoords[0],
		    relativeMotionY = paint.lastGrabCoords[1] - targetCoords[1];

		paint.goto(paint.local.leftTopX + (relativeMotionX / paint.local.zoom), paint.local.leftTopY + (relativeMotionY / paint.local.zoom));

		// Update last grab position
		paint.lastGrabCoords = targetCoords;
	},
	line: function line (paint, event) {
		if (event == "remove") {
			delete paint.lastLinePoint;
			paint.effectsCanvas.style.cursor = "";
			return;
		}

		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);

		if ((event.type == "mousedown" || event.type == "touchstart") && !paint.lastLinePoint) {
			paint.lastLinePoint = targetCoords;
		}

		if (event.type == "mouseup" || event.type == "touchend") {
			// If mouseup is on the same point as mousedown we switch behaviour by making
			// a line between two clicks instead of dragging
			if (paint.lastLinePoint[0] == targetCoords[0] && paint.lastLinePoint[1] == targetCoords[1]) {
				return;
			}

			paint.addUserDrawing({
				type: "line",
				x: Math.round(paint.local.leftTopX + (paint.lastLinePoint[0] / paint.local.zoom)),
				y: Math.round(paint.local.leftTopY + (paint.lastLinePoint[1] / paint.local.zoom)),
				x1: Math.round(paint.local.leftTopX + (targetCoords[0] / paint.local.zoom)),
				y1: Math.round(paint.local.leftTopY + (targetCoords[1] / paint.local.zoom)),
				size: paint.current_size * 2,
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
			context.arc(paint.lastLinePoint[0], paint.lastLinePoint[1], paint.current_size * paint.local.zoom, 0, 2 * Math.PI, true);
			context.fillStyle = paint.current_color.toRgbString();
			context.fill();

			context.beginPath();
			context.moveTo(paint.lastLinePoint[0], paint.lastLinePoint[1]);
			context.lineTo(targetCoords[0], targetCoords[1]);			
			context.strokeStyle = paint.current_color.toRgbString();
			context.lineWidth = paint.current_size * paint.local.zoom * 2;
			context.stroke();

			context.beginPath();
			context.arc(targetCoords[0], targetCoords[1], paint.current_size * paint.local.zoom, 0, 2 * Math.PI, true);
			context.fillStyle = paint.current_color.toRgbString();
			context.fill();			
		}
	},
	brush: function brush (paint, event, type) {
		if (event == "remove") {
			delete paint.lastBrushPoint;
			delete paint.lastMovePoint;
			return;
		}

		this.lastMovePoint = this.lastMovePoint || [0, 0];

		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);

		if (event.type == "mousedown" || event.type == "touchstart") {
			paint.brushing = true;
			paint.addUserPath();
			paint.addUserPathPoint([Math.round(paint.local.leftTopX + (targetCoords[0] / paint.local.zoom)),
			                        Math.round(paint.local.leftTopY + (targetCoords[1] / paint.local.zoom))]);
		}

		if (event.type == "mouseup" || event.type == "touchend" || event.type == "mouseleave") {
			paint.endUserPath();
			paint.brushing = false;
		}

		if (event.type == "mousemove" || event.type == "touchmove") {
			// Clear the previous mouse dot
			paint.effectsCanvasCtx.clearRect(this.lastMovePoint[0] - paint.current_size * paint.local.zoom * 2, this.lastMovePoint[1] - paint.current_size * paint.local.zoom * 2, paint.current_size * paint.local.zoom * 4, paint.current_size * paint.local.zoom * 4);

			// Draw the current mouse position
			var context = paint.effectsCanvasCtx;
			context.beginPath();
			context.arc(targetCoords[0], targetCoords[1], paint.current_size * paint.local.zoom, 0, 2 * Math.PI, true);
			context.fillStyle = paint.current_color.toRgbString();
			context.fill();

			// Save the last move point for efficient clearing
			this.lastMovePoint[0] = targetCoords[0];
			this.lastMovePoint[1] = targetCoords[1];

			// If the last brush point is set we are currently drawing
			if (paint.brushing) {
				paint.addUserPathPoint([Math.round(paint.local.leftTopX + (targetCoords[0] / paint.local.zoom)),
			                        Math.round(paint.local.leftTopY + (targetCoords[1] / paint.local.zoom))]);
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

		if ((event.type == "mousedown" || event.type == "touchstart") && !paint.picking) {
			paint.picking = true;
			paint.setColor(paint.getColorAt(targetCoords));
			paint.effectsCanvas.style.cursor = "crosshair";
		}

		if (event.type == "mouseup" || event.type == "touchend") {
			delete paint.picking;
			paint.effectsCanvas.style.cursor = "";
		}

		if (event.type == "mousemove" || event.type == "touchmove") {
			if (paint.picking)
				paint.setColor(paint.getColorAt(targetCoords));
		}
	},
	block: function block (paint, event) {
		this.brush(paint, event, "block");
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

		context.moveTo(drawing.x, drawing.y);
		context.lineTo(drawing.x1, drawing.y1);
		
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
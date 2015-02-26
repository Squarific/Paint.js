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
	this.changeColor("#000000")
	this.current_tool = "brush";
	this.current_color = "#000000";
	this.current_size = 5;
	$(this.controls.byName["tool-color"].input).spectrum("set", this.current_color);

	this.localDrawings = [];

	window.addEventListener("resize", this.resize.bind(this));
}

Paint.prototype.defaultSettings = {
	maxSize: 50,
	maxLineLength: 200
};

Paint.prototype.addCanvas = function addCanvas (container) {
	var publicC   = container.appendChild(this.createCanvas("public"));
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

	effectC.addEventListener("touchstart", this.exectool.bind(this));
	effectC.addEventListener("touchmove", this.exectool.bind(this));
	effectC.addEventListener("touchend", this.exectool.bind(this));

	this.canvasArray = [publicC, localC, effectC];
	this.lastCanvas = localC;
};

Paint.prototype.newCanvasOnTop = function newCanvasOnTop (name) {
	var canvas = this.createCanvas(name || "foreign");

	// Insert the canvas behind the current last canvas
	this.lastCanvas.parentNode.insertBefore(canvas, this.lastCanvas.nextSibling);

	// Put it as new canvas, put it in the canvasarray and return
	this.lastCanvas = canvas;
	this.canvasArray.push(canvas);
	return canvas;
};

Paint.prototype.clear = function clear () {
	this.public.clearAll();
	this.local.clearAll();

	this.public.redraw();
	this.local.redraw();
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
};

Paint.prototype.redrawLocalDrawings = function redrawLocalDrawings () {
	// Redraw the locals in the current loop
	this.redrawLocalsNeeded = true;

	if (!this.drawDrawingTimeout)
		this.drawDrawingTimeout = setTimeout(this.redrawLoop.bind(this), 20);
};

Paint.prototype.redrawLoop = function redrawLoop () {
	for (var layer in this.redrawLayers) {
		this[layer].redraw();
	}

	if (this.redrawLocalsNeeded)
		this.redrawLocals();
	
	delete this.drawDrawingTimeout;
	delete this.redrawLocalsNeeded;
};

Paint.prototype.redrawLocals = function redrawLocals () {
	// Force the redrawing of locals NOW
	this.local.clearAll();
	this.localDrawings.forEach(this.drawDrawing.bind(this, "local"));
}

Paint.prototype.removeLocalDrawing = function removeLocalDrawing (drawing) {
	var index = this.localDrawings.indexOf(drawing);
	this.localDrawings.splice(index, 1);
	this.redrawLocalDrawings();
};

Paint.prototype.addPublicDrawing = function addPublicDrawing (drawing) {
	this.drawDrawing("public", drawing);
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

// Put the drawings on the given layer ('public', 'local', 'effects')
Paint.prototype.drawDrawings = function drawDrawings (layer, drawings) {
	for (var dKey = 0; dKey < drawings.length; dKey++) {
		this.drawFunctions[drawings[dKey].type](this[layer].context, drawings[dKey], this[layer]);
	}
	this[layer].redraw();
};

// Put the drawing on the given layer ('public', 'local', 'effects')
Paint.prototype.drawDrawing = function drawDrawing (layer, drawing) {
	this.drawFunctions[drawing.type](this[layer].context, drawing, this[layer]);

	this.redrawLayers = this.redrawLayers || {};
	this.redrawLayers[layer] = true;

	if (!this.drawDrawingTimeout)
		this.drawDrawingTimeout = setTimeout(this.redrawLoop.bind(this), 20);
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
	this.current_color = color;
	this.effectsCanvasCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
};

Paint.prototype.changeToolSize = function changeToolSize (size) {
	if (size > this.settings.maxSize) size = this.settings.maxSize;
	this.current_size = parseInt(size);
	console.log(this.current_size);
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
		name: "tool-color",
		type: "color",
		text: "Tool color",
		value: "#FFFFFF",
		title: "Change the color of the tool",
		action: this.changeColor.bind(this)
	}];
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

	return this.rgbToHex(pixel[0], pixel[1], pixel[2]);
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

		paint.local.goto(paint.local.leftTopX + relativeMotionX, paint.local.leftTopY + relativeMotionY);
		paint.public.goto(paint.public.leftTopX + relativeMotionX, paint.public.leftTopY + relativeMotionY);

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
				x: paint.local.leftTopX + paint.lastLinePoint[0],
				y: paint.local.leftTopY + paint.lastLinePoint[1],
				x1: paint.local.leftTopX + targetCoords[0],
				y1: paint.local.leftTopY +targetCoords[1],
				size: paint.current_size * 2,
				color: paint.current_color
			});

			delete paint.lastLinePoint;
			paint.effectsCanvasCtx.clearRect(0, 0, paint.effectsCanvas.width, paint.effectsCanvas.height);
		}

		if ((event.type == "mousemove" || event.type == "touchmove") && paint.lastLinePoint) {
			paint.effectsCanvasCtx.clearRect(0, 0, paint.effectsCanvas.width, paint.effectsCanvas.height);

			var context = paint.effectsCanvasCtx;
			context.beginPath();
			context.arc(paint.lastLinePoint[0], paint.lastLinePoint[1], paint.current_size, 0, 2 * Math.PI, true);
			context.fillStyle = paint.current_color;
			context.fill();

			context.beginPath();
			context.moveTo(paint.lastLinePoint[0], paint.lastLinePoint[1]);
			context.lineTo(targetCoords[0], targetCoords[1]);			
			context.strokeStyle = paint.current_color;
			context.lineWidth = paint.current_size * 2;
			context.stroke();

			context.beginPath();
			context.arc(targetCoords[0], targetCoords[1], paint.current_size, 0, 2 * Math.PI, true);
			context.fillStyle = paint.current_color;
			context.fill();			
		}
	},
	brush: function brush (paint, event, type) {
		if (event == "remove") {
			delete paint.lastBrushPoint;
			return;
		}

		// Get the coordinates relative to the canvas
		var targetCoords = paint.getCoords(event);

		if ((event.type == "mousedown" || event.type == "touchstart") && !paint.lastLinePoint) {
			paint.lastBrushPoint = targetCoords;
			paint.addUserDrawing({
				type: "brush",
				x: paint.local.leftTopX + targetCoords[0],
				y: paint.local.leftTopY + targetCoords[1],
				size: paint.current_size,
				color: paint.current_color
			});
		}

		if (event.type == "mouseup" || event.type == "touchend") {
			delete paint.lastBrushPoint;
		}

		if (event.type == "mousemove" || event.type == "touchmove") {
			paint.effectsCanvasCtx.clearRect(0, 0, paint.effectsCanvas.width, paint.effectsCanvas.height);
			var context = paint.effectsCanvasCtx;
			context.beginPath();
			context.arc(targetCoords[0], targetCoords[1], paint.current_size, 0, 2 * Math.PI, true);
			context.fillStyle = paint.current_color;
			context.fill();

			if (paint.lastBrushPoint) {
				if (paint.utils.sqDistance(paint.lastBrushPoint, targetCoords) < (paint.current_size / 2) * (paint.current_size / 2)) {
					paint.addUserDrawing({
						type: "brush",
						x: paint.local.leftTopX + targetCoords[0],
						y: paint.local.leftTopY + targetCoords[1],
						size: paint.current_size,
						color: paint.current_color
					});
				} else {
					paint.addUserDrawing({
						type: "line",
						x: paint.local.leftTopX + paint.lastBrushPoint[0],
						y: paint.local.leftTopY + paint.lastBrushPoint[1],
						x1: paint.local.leftTopX + targetCoords[0],
						y1: paint.local.leftTopY + targetCoords[1],
						size: paint.current_size * 2,
						color: paint.current_color
					});
				}
				paint.lastBrushPoint = targetCoords;
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
// Should return true on success

Paint.prototype.drawFunctions = {
	brush: function (context, drawing, tiledCanvas) {
		context.beginPath();
		context.arc(drawing.x, drawing.y, drawing.size, 0, 2 * Math.PI, true);
		context.fillStyle = drawing.color;
		context.fill();


		if (tiledCanvas) {
			tiledCanvas.drawingRegion(drawing.x, drawing.y, drawing.x, drawing.y, drawing.size);
			tiledCanvas.executeNoRedraw();
		}
	},
	block: function (context, drawing, tiledCanvas) {
		context.fillStyle = drawing.color;
		context.fillRect(drawing.x, drawing.y, drawing.size, drawing.size);

		if (tiledCanvas) {
			tiledCanvas.drawingRegion(drawing.x, drawing.y, drawing.x, drawing.y, drawing.size);
			tiledCanvas.executeNoRedraw();
		}
	},
	line: function (context, drawing, tiledCanvas) {
		this.brush(context, {
			x: drawing.x,
			y: drawing.y,
			color: drawing.color,
			size: drawing.size / 2
		}, tiledCanvas);

		context.beginPath();

		context.moveTo(drawing.x, drawing.y);
		context.lineTo(drawing.x1, drawing.y1);
		
		context.strokeStyle = drawing.color;
		context.lineWidth = drawing.size;

		context.stroke();
		
		if (tiledCanvas) {
			tiledCanvas.drawingRegion(drawing.x, drawing.y, drawing.x1, drawing.y1, drawing.size);
			tiledCanvas.executeNoRedraw();
		}

		this.brush(context, {
			x: drawing.x1,
			y: drawing.y1,
			color: drawing.color,
			size: drawing.size / 2
		}, tiledCanvas);
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
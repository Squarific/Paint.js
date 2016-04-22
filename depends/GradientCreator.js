/*
	LICENSE: MIT
	Author: Filip Smets
*/

/*
	Creates the creator
	Everything inside container could be removed
	All properties of container could be overwritten, including style
*/
function GradientCreator (container) {
	this._container = container;
	this.setupDom();
	this.rerender();
}

GradientCreator.prototype.INITIAL_STOPS = [{
	pos: 0,
	color: "rgba(255, 0, 0, 1)"
}, {
	pos: 0.15,
	color: "rgba(255, 255, 0, 1)"
}, {
	pos: 0.3,
	color: "rgba(0, 255, 0, 1)"
}, {
	pos: 0.5,
	color: "rgba(0, 255, 255, 1)"
}, {
	pos: 0.65,
	color: "rgba(0, 0, 255, 1)"
}, {
	pos: 0.80,
	color: "rgba(255, 0, 255, 1)"
}, {
	pos: 1,
	color: "rgba(255, 0, 0, 1)"
}];

/*
	#################
	# DOM FUNCTIONS #
	#################
*/

/*
	Removes everything inside the container, then creates all elements
	Container will be taken from this._container
*/
GradientCreator.prototype.setupDom = function setupDom () {
	// Remove all elements in the container
	while (this._container.firstChild)
		this._container.removeChild(this._container.firstChild)

	this.createPreviewDom();
	this.createColorSelector();
};

/*
	Create a div for the preview and add inital colors
*/
GradientCreator.prototype.createPreviewDom = function createPreviewDom () {
	var preview = this._container.appendChild(document.createElement("div"));
	preview.classList.add("gradient-preview");
	this._previewDom = preview;

	document.addEventListener("mousemove", function (event) {
		if (!this._draggingStop) return;
		var relativeWidth = this.getRelativeWidth(event, this._previewDom);

		// Clamp between 0 and 1
		relativeWidth = Math.min(1, Math.max(0, relativeWidth));

		this._draggingStop.style.left = relativeWidth * 100 + "%";
		this._hasDragged = true;
		this.hideColorPicker();
		this.rerender();
	}.bind(this));

	document.addEventListener("touchmove", function (event) {
		if (!this._draggingStop) return;
		var relativeWidth = this.getRelativeWidth(event, this._previewDom);

		// Clamp between 0 and 1
		relativeWidth = Math.min(1, Math.max(0, relativeWidth));

		this._draggingStop.style.left = relativeWidth * 100 + "%";
		this._hasDragged = true;
		this.hideColorPicker();
		this.rerender();
	}.bind(this));

	document.addEventListener("mouseup", function (event) {
		delete this._draggingStop;
	}.bind(this));

	document.addEventListener("touchend", function (event) {
		delete this._draggingStop;
	}.bind(this));

	document.addEventListener("click", function (event) {
		if (event.target.classList.contains("gradient-stop")) return;
		this.hideColorPicker();
	}.bind(this));

	preview.addEventListener("dblclick", function (event) {
		var relativeWidth = this.getRelativeWidth(event, this._previewDom);
		this.createStop({
			pos: relativeWidth,
			color: tinycolor()
		});
	}.bind(this));

	this.INITIAL_STOPS.forEach(this.createStop.bind(this));
};

/*
	This function creates a stop dom element from {pos: 0-1, color: tinycolor/csscolor/...}
	It also fires the change event and rerenders
*/
GradientCreator.prototype.createStop = function createStop (stop) {
	var stopDom = this._previewDom.appendChild(document.createElement("div"))
	stopDom.className = "gradient-stop";
	stopDom.style.background = stop.color;
	stopDom.style.left = stop.pos * 100 + "%";
	stopDom.color = tinycolor(stop.color);

	stopDom.addEventListener("mousedown", function (event) {
		this._draggingStop = stopDom;
		this._hasDragged = false;
	}.bind(this));

	stopDom.addEventListener("touchstart", function (event) {
		this._draggingStop = stopDom;
		this._hasDragged = false;
	}.bind(this));

	stopDom.addEventListener("click", function (event) {
		if (this._hasDragged) return;
		this.changeColorOf(stopDom);
	}.bind(this))

	stopDom.addEventListener("dblclick", function (event) {
		stopDom.parentNode.removeChild(stopDom);

		if (event.stopPropagation) event.stopPropagation();
		event.cancelBubble = true;

		this.rerender();
	}.bind(this))

	this.rerender();
};

GradientCreator.prototype.hideColorPicker = function hideColorPicker () {
	delete this._changingColorOf;

	// Search for the color picker
	for (var k = 0; k < this._previewDom.children.length; k++) {

		// Found
		if (this._previewDom.children[k].classList.contains("sp-container")) {
				this._previewDom.children[k].classList.add("hide");
		}
	}
};

GradientCreator.prototype.changeColorOf = function changeColorOf (stop) {
	// Search for the color picker
	for (var k = 0; k < this._previewDom.children.length; k++) {

		// Found
		if (this._previewDom.children[k].classList.contains("sp-container")) {

			// Place it at the stop
			this._previewDom.children[k].style.left = stop.style.left;

			// If we are already changing the color of this one just remove the color picker
			if (this._changingColorOf == stop) {
				this._previewDom.children[k].classList.add("hide");

			// Otherwise show it
			} else {
				this._previewDom.children[k].classList.remove("hide");
				$(this.spectrumInput).spectrum("set", stop.color);
			}
		}
	}

	this._changingColorOf = stop;
};

/*
	Creates the color selector
*/
GradientCreator.prototype.createColorSelector = function createColorSelector () {
	var input = this._previewDom.appendChild(document.createElement("input"));
	input.type = "color";

	this.spectrumInput = input;

	$(this.spectrumInput).spectrum({
		showAlpha: true,
		showInput: true,
		showButtons: false,
		flat: true,
		showInitial: true,
		preferredFormat: "rgb",
		showPalette: true,
		maxSelectionSize: 32,
		clickoutFiresChange: true,		
		move: function (color) {
			if (this._changingColorOf) {
				this._changingColorOf.color = color;
				this._changingColorOf.style.background = color;
				this.rerender();
			}
		}.bind(this)
	});

	this.hideColorPicker();
};

/*

	###################
	# General methods #
	###################

*/

/*
	Get an array of the current stops
	Example: [{pos: 0, color: tinycolor()}, {pos: 1, color: tinycolor()}]
*/
GradientCreator.prototype.getStops = function getStops () {
	var stops = [];

	for (var key = 0; key < this._previewDom.children.length; key++) {
		if (!this._previewDom.children[key].classList.contains("gradient-stop")) continue;
		stops.push({
			pos: parseFloat(this._previewDom.children[key].style.left.slice(0, -1)) / 100,
			color: this._previewDom.children[key].color
		});
	}

	stops.sort(function (a, b) {
		return a.pos - b.pos;
	});

	return stops;
};

/*
	Given an event object it will return the relative width between 0 and 1.
	Works with touch events.
*/
GradientCreator.prototype.getRelativeWidth = function getRelativeWidth (event, target) {
	// If there is no clientX/Y (meaning no mouse event) and there are no changed touches
	// meaning no touch event, then we can't get the coords relative to the target element
	// for this event
	if (typeof event.clientX !== "number" && (!event.changedTouches || !event.changedTouches[0] || typeof event.changedTouches[0].clientX !== "number"))
		return 0;

	// Return the coordinates relative to the target element
	var clientX = (typeof event.clientX === 'number') ? event.clientX : event.changedTouches[0].clientX,
	    target = target || event.target || document.elementFromPoint(clientX, clientY);

	var boundingClientRect = target.getBoundingClientRect();
	var relativeX = clientX - boundingClientRect.left;

	return relativeX / boundingClientRect.width;
};


/*
	Replace the css of the preview div to match the stops
	Should be called when the stops have changed
	This function also fires the change event
*/
GradientCreator.prototype.rerender = function rerender () {
	var parsedStops = this.getStops().map(function (stop, index, stops) {
		return stop.color + " " + stop.pos * 100 + "%";
	});

	this._previewDom.style.background = "linear-gradient(90deg, " + parsedStops.join(",") + ")";

	this.dispatchEvent({
		type: "change",
		stops: this.getStops()
	});
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

EventDispatcher.prototype.apply(GradientCreator.prototype);
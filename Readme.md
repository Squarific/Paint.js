Paint.js
========

A drawing app that can easily be used to create networked drawing apps.

LICENSE: MIT

Demo
====

##Pure paint.js:

http://squarific.github.io/Paint.js/demo.html

##Used in another project:

http://www.anondraw.com

Dependency
==========

	jQuery is required

How to use
==========

Include Paint.min.js, paint.css and spectrum.css
Make sure the container has the position property set!

Create a paint object:

    var container = document.getElementById("container");
    var paint = new Paint(container);

Now you can bind to events:

	paint.addEventListener("drawing", function (event) {
		console.log(event.type);
		console.log(event.drawing);
	});

The above code will output the following when a line is drawn:

	"drawing"
	{type: "line", x: 4, y: 5, x1: 6, y1: 7, size: 10, color: "#ffaabb"}

Methods
=======

	paint.drawDrawings(layer, drawingArray);
	paint.drawDrawing(layer, drawing);

These functions will put the drawings on the given layer. Layer can be 'public' or 'local'.

	paint.changeTool(tool);
	paint.changeColor(color);
	paint.changeToolSize(size);

These functions allow you to change the tool, color and size.
Tool can be one of the following: "grab", "line", "brush" or "block"*

*Block not yet implemented

	paint.clear();

Clears all drawings.

Events
======

	{
		type: "userdrawing"             // The type of event
		drawing: {type: "brush", ...}   // The drawing that was just added
		removeDrawing: function () {}   // Remove the drawing from the local layer
		                                // For example when the server acknowledged the drawing
		                                // or if the user wasn't allowed to draw
	}

Drawing types
=============

Brush (dot):

	{type: "brush", x: int, y: int, size: int, color: string}

Block:

	{type: "block", x: int, y: int, size: int, color: string}

Line:
	
	{type: "line", x: int, y: int, x1: int, y1: int, size: int, color: string}

Controls
========

Controls can be added to

    paint.controlContainer; // Dom element that contains all controllers

Adding new tools
================

If you want to add a new tool you have to do 2 things. Add a button and add a event handling function.

## Adding the button ##

The button will look like this:

    {
    	name: "toolName",
    	type: "button",
    	image: "images/icons/toolName.png",
    	title: "Change tool to toolName",
    	value: "toolNameFunction",
    	action: this.changeTool.bind(this)
    }

This object should be added to the createControlArray function.

## Adding the event handler ##

The event handler looks like this:

    function toolNameFunction (paint, event) {

    }

This function should be added to 'Paint.tools'.

Possible events are: 

	"remove"
	
	{type: "mousedown", ...}
	{type: "mousemove", ...}
	{type: "mouseup", ...}

	{type: "touchstart", ...}
	{type: "touchmove", ...}
	{type: "touchend", ...}

You can then use all methods on the paint object, some you will need are: 

    // Returns the coordinates of the event relative to the canvas
    // To get relative to the world, do + paint.layer.leftTopX and leftTopY
    paint.getCoords(event);

    // TiledCanvas objects for the last layer and the local layer
    paint.public
    paint.local

    // The canavas and context on top of all other layers
    paint.effectCanvas
    paint.effectCanvasCtx

### Template: ###

	if (event == "remove") {
		delete paint.lastPickerPoint;
		return;
	}

	// Get the coordinates relative to the world
	var targetCoords = paint.getCoords(event);

	if ((event.type == "mousedown" || event.type == "touchstart") && !paint.lastPickerPoint) {
		
	}

	if (event.type == "mouseup" || event.type == "touchend") {
		
	}

	if (event.type == "mousemove" || event.type == "touchmove") {
		
	}

Adding new drawing types
========================

TBA
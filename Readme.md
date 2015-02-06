Paint.js
========

A drawing app that can easily be used to create networked drawing apps.

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

function Controls (container, controls) {
	this.controls = controls || [];
	this.byName = {};
    this.container = container;

	this.buildControls();
}

// Removes everything from the container and
// Creates the given controls, includes adding them to .byName
Controls.prototype.buildControls = function buildControls () {
	// Empty the container
	while (this.container.firstChild) {
		this.container.removeChild(container.firstChild);
	}

	// Create each controler from its definition
	// Add to the container and .byName
	for (var cKey = 0; cKey < this.controls.length; cKey++) {
		var control = this.createControl(this.controls[cKey])
		this.container.appendChild(control.containerAppend);
		this.byName[this.controls[cKey].name] = control;
		if (typeof control.executeAfterAppend == "function") {
			control.executeAfterAppend();
		}
	}
};

// CreateControl calls the constructor for the given control
Controls.prototype.createControl = function createControl (control) {
	if (typeof this.constructors[control.type] == "function") {
		return this.constructors[control.type](control);
	}

	// Control is not defined
	console.error("Unknown control: " + control.type, control);
	return document.createTextNode("Unknown control: " + control.type);
};

// Object that holds all the contruction functions for the controllers
// A construction object should return whatever should be stored in .byName["nameOfTheControl"]
// The returned object should at least have:
//{
//	input: domElement,              //DomElement of which .value can be get and set,
//	containerAppend: domElement,    // Element that should be appended to the container
//}
Controls.prototype.constructors = {};

Controls.prototype.constructors.button = function createButton (control) {
	var input = document.createElement("div");
	input.className = (control.classAppend || "") + "control-button";

	if (control.value)
		input.value = control.value;

	if (control.text)
		input.appendChild(document.createTextNode(control.text));

	if (control.image) {
		var img = input.appendChild(document.createElement("img"));
		img.src = control.image;
		img.alt = control.alt;
	}

	if (control.title)
		input.title = control.title;

	input.addEventListener("click", function (event) {
		control.action(input.value);
		event.preventDefault();
	});

	return {
		input: input,
		containerAppend: input
	}
};

Controls.prototype.constructors.integer = function createIntegerInput (control) {
	var container = document.createElement("div");
	container.className = (control.classAppend || "") + "control-integer";

	// Create the actual input field
	var input = document.createElement("input");
	input.type = control.range ? "range" : "number";
	input.value = control.value;
	input.className = (control.classAppend || "") + "control-integer-input";

	if (control.text)
		input.placeholder = control.text;

	if (control.title)
		input.title = control.title;

	if (control.max)
		input.max = control.max;

	if (control.min)
		input.min = control.min;

	input.addEventListener("input", function () {
		control.action(input.value);
	});

	// Create the minus button
	var minusButton = container.appendChild(this.button({
		text: "-",
		action: function () {
			var max = parseInt(input.max || Infinity);
			var nextValue = parseInt(input.value) - 1;
			input.value = Math.min(max, nextValue);
			control.action(input.value);
		}
	}).containerAppend);

	// Append the input
	container.appendChild(input);

	// Create a plus button
	container.appendChild(this.button({
		text: "+",
		action: function () {
			var max = parseInt(input.max || Infinity);
			var nextValue = parseInt(input.value) + 1;
			input.value = Math.min(max, nextValue);
			control.action(input.value);
		}
	}).containerAppend);

	return {
		input: input,
		containerAppend: container
	}
};

Controls.prototype.constructors.text = function createTextInput (control) {
	// Create the actual input field
	var input = document.createElement("input");
	input.type = "text";
	input.value = control.value;
	input.className = (control.classAppend || "") + "control-text-input";

	if (control.text)
		input.placeholder = control.text;

	if (control.title)
		input.title = control.title;

	if (control.max)
		input.max = control.max;

	if (control.min)
		input.min = control.min;

	input.addEventListener("input", function () {
		control.action(input.value);
	});

	return {
		input: input,
		containerAppend: input
	}
};

Controls.prototype.constructors.color = function createColorInput (control) {
	// Create the actual input field
	var input = document.createElement("input");
	input.type = "text";
	input.value = control.value;
	input.className = (control.classAppend || "") + "control-color-input";

	var returnData = {
		input: input,
		containerAppend: input,
		executeAfterAppend: function () {
			var spectrum = $(input).spectrum({
				showAlpha: true,
				showInput: true,
				showInitial: true,
				preferredFormat: "rgb",
				showPalette: true,
				maxSelectionSize: 32,
				clickoutFiresChange: true,		
				move: function (color) {
					control.action(color);
				}
			});
		}
	};

	return returnData;
};
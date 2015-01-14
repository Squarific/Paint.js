var fs = require("fs");

fs.readdir("depends", function (err, files) {
	if (err) throw err;

	var minimizedFile = "";
	for (var fKey = 0; fKey < files.length; fKey++) {
		minimizedFile += fs.readFileSync("depends/" + files[fKey], {encoding: "utf-8"});
	}

	minimizedFile += fs.readFileSync("Paint.js", {encoding: "utf-8"});

	fs.writeFile("Paint.min.js", minimizedFile, function (err) {
		if (err) throw err;
	});
});
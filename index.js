'use strict';

/**
 * Compiles HTL (.html) files that have a /htlmock directory from sourceDir to targetDir
 * @param sourceDir
 * @param targetDit
 * @param callback
 */
module.exports = function (sourceDir, targetDir, doneCallback) {
	const fs = require('fs');
	const path = require('path');
	const Compiler = require("@adobe/htlengine/src/compiler/Compiler");

	const start = Date.now();
	const originalDir = path.resolve('.');

	const ATTRIBUTE_DELAYED_RESOURCE = 'data-delayed-sly-resource'; //gets converted to data-sly-resource AFTER the initial parsing

	sourceDir = path.isAbsolute(sourceDir) ? sourceDir : path.resolve(sourceDir);
	targetDir = path.isAbsolute(targetDir) ? targetDir : path.resolve(targetDir);
	console.log('Compiling contents of ' + sourceDir + ' to ' + targetDir);
	console.log('...from ' + originalDir);

	/** find all html files **/
	function findFilesInDir(startPath,filter){
		var results = [];
		if (!fs.existsSync(startPath)){
			console.error("no dir ",startPath);
			return;
		}

		var files=fs.readdirSync(startPath);
		for(var i=0;i<files.length;i++){
			var filename=path.join(startPath,files[i]);
			var stat = fs.lstatSync(filename);
			if (stat.isDirectory()){
				results = results.concat(findFilesInDir(filename,filter)); //recurse
			}
			else if (filename.indexOf(filter)>=0) {
				results.push(filename);
			}
		}
		return results;
	}
//attain all html files, filter them to exclude html files that do not have a htlmock directory in the same directory as the html file.
	let unfilteredHtmlFiles = findFilesInDir(sourceDir, '.html');
	let templatesFilePaths = [];
	let totalCompiled = 0;
	for (var index = 0; index < unfilteredHtmlFiles.length; index++) {
		let filePath = unfilteredHtmlFiles[index];
		let mockPath = path.dirname(filePath) + '/htlmock';
		if (fs.existsSync(mockPath) && fs.lstatSync(mockPath).isDirectory()) {
			templatesFilePaths.push(filePath);
		}
	}
	console.log('Start compiling HTL files: \n\r  ' + templatesFilePaths.join('\n\r  '));

	/** compile found html files **/
	const compiler = new Compiler().includeRuntime(true).withRuntimeVar('wcmmode');

	var templatesToCompile = [];
	function next() {
		if (templatesToCompile.length > 0) {
			var lastTime = Date.now();
			var filePath = templatesToCompile.shift();
			process.chdir(path.dirname(filePath) + '/htlmock');
			let templateFile = fs.readFileSync(filePath, "utf8");

			/* We manipulate data-sly-include into data-sly-resource until Adobe creates include support.
			 * First we rename it to data-slyresource and provide an absolute path, it later on gets added to the toCompile queue
			 * The next time it will get compiled, we change data-slyresource into data-sly-resource and include the targeted component
			 */
			templateFile = templateFile.replace(ATTRIBUTE_DELAYED_RESOURCE, 'data-sly-resource');
			templateFile = templateFile.replace(/data-sly-include="([^\/]+)"/, '><div '+ATTRIBUTE_DELAYED_RESOURCE+'="'+path.dirname(filePath)+'/$1.html"></div><sly></sly');
			templateFile = templateFile.replace(/data-sly-include="(.*\/(.*))"/, '><div '+ATTRIBUTE_DELAYED_RESOURCE+'="'+targetDir+'$1/$2.html"></div><sly></sly');

			var result = compiler.compileToString(templateFile);
			try {
				let currentTemplateFilePath = filePath + '.' + (totalCompiled++) + '.js';
				fs.writeFile(currentTemplateFilePath, result, 'utf8', function(errors) {
					if (errors) {
						console.error(errors);
					} else {
						let currentTemplate = require(currentTemplateFilePath);
						let result = currentTemplate.main({'wcmmode':false}).then(function(result){handleResult(result, filePath, lastTime)}, handleError);
					}
				});
			}
			catch(e) {
				console.error('An error occurred while compiling ' + filePath, e);
			}
		} else {
			done();
		}

	}
	/** writes contents to a path, creates nonexisting directories **/
	function writeFile(targetFilePath, contents, lastTime, callback) {
		process.chdir(originalDir);
		fs.writeFile(targetFilePath, contents, 'utf8', function(errors) {
			if (errors) {
				console.error('write errors: ', errors);
			}
			console.log(targetFilePath + '... ' + (Date.now() - lastTime) + 'ms');
			//if we find a delayed resource, add this file to the toCompile queue so it can load the resource after the initial parsing
			if (contents.indexOf(ATTRIBUTE_DELAYED_RESOURCE) !== -1) {
				templatesToCompile.push(targetFilePath);
			}
			callback();
		});
	}
	function handleResult(result, filePath, lastTime) {
		writeFile(filePath, result.body, lastTime, next);
	}
	function handleError(error) {
		console.error(error);
		next();
	}
	function done() {
		console.log('----------');
		console.log('Done compiling in ' + (Date.now() - start) + 'ms');
		doneCallback();
	}


	function copyFile(fileName, callback) {
		let relative = path.relative(sourceDir, fileName);
		let targetFile = path.join(targetDir, relative);

		let relativePath = path.relative(originalDir, path.parse(targetFile).dir);
		let partialPath = '';
		let parts = relativePath.split(path.sep);
		for (var i = 0; i < parts.length; i++) {
			partialPath = path.join(partialPath, parts[i]);
			if (!fs.existsSync(partialPath)) {
				let dirPath = path.relative(originalDir, partialPath);
				fs.mkdirSync(dirPath);
			}
		}
		fs.copyFile(fileName, targetFile, callback);

		return targetFile;
	}

	let copiesLeft = templatesFilePaths.length;
	function fileCopied() {
		copiesLeft--;
		if (copiesLeft === 0) {
			next();
		}
	}

//first we copy all template files to the compile directory, then we start compiling those file
	for(var i = 0; i < templatesFilePaths.length; i++){
		let templateFile = templatesFilePaths[i];

		let targetFile = copyFile(templateFile, fileCopied);
		templatesToCompile.push(targetFile);

		let models = findFilesInDir(path.dirname(templateFile) + '/htlmock', '');
		for (var j = 0; j < models.length; j++) {
			copiesLeft++;
			copyFile(models[j], fileCopied);
		}
	}
};

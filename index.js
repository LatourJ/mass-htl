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

	var defaultData = {
		wcmmode: {},
		properties: {}
	};

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
	for (var index = 0; index < unfilteredHtmlFiles.length; index++) {
		let filePath = unfilteredHtmlFiles[index];
		let mockPath = path.dirname(filePath) + '/htlmock';
		if (fs.existsSync(mockPath) && fs.lstatSync(mockPath).isDirectory()) {
			templatesFilePaths.push(filePath);
		}
	}
	console.log('Start compiling HTL files: \n\r  ' + templatesFilePaths.join('\n\r  '));

	/** compile found html files **/
	let templatesToCompile = [];
	let filesCompiledCount = 0;
	function next() {
		if (templatesToCompile.length > 0) {
			var lastTime = Date.now();
			var filePath = templatesToCompile.shift();
			var mockPath = path.dirname(filePath) + '/htlmock';
			process.chdir(mockPath);
			let templateFile = fs.readFileSync(filePath, "utf8");

			let mockData = readMockData(mockPath);

			/* We manipulate data-sly-include into data-sly-resource until Adobe creates include support.
			 * First we rename it to data-slyresource and provide an absolute path, it later on gets added to the toCompile queue
			 * The next time it will get compiled, we change data-slyresource into data-sly-resource and include the targeted component
			 */
			templateFile = templateFile.replace(ATTRIBUTE_DELAYED_RESOURCE, 'data-sly-resource');
			templateFile = replaceAll(templateFile, /data-sly-include="([^\/]+)"/, '><div '+ATTRIBUTE_DELAYED_RESOURCE+'="'+path.dirname(filePath)+'/$1"></div></sly><sly');
			templateFile = templateFile.replace(/data-sly-include="(.*\/(.*))"/, '><div '+ATTRIBUTE_DELAYED_RESOURCE+'="'+targetDir+'/$1"></div></sly><sly');
			/* We restructure data-sly-resource=${@path=foo, resourceType=bar} into (and consider resourceType) data-sly-resource=full/path/to/bar
			 * or substitute the mocked value until there is proper support for resourceType
			 */
			templateFile = replaceAll(templateFile, /data-sly-resource="\${.*resourceType='(.+\/(.+))'}"/, function(match, p1, p2) {
				if (mockData[p1] != null) {
					return 'data-sly-resource="' + mockData[p1] + '"';
				} else {
					return 'data-sly-resource="'+targetDir + p1 + '/' + p2 + '.html"'
				}
			});

			var test = {properties:{}, wcmmode:{}, pageProperties:{}}
			var result = new Compiler().includeRuntime(true).withRuntimeVar(Object.keys(test)).compileToString(templateFile);
			try {
				let currentTemplateFilePath = path.dirname(filePath) + '/htlmock/' + path.basename(filePath) + '.' + (filesCompiledCount++);
				fs.writeFile(currentTemplateFilePath, result, 'utf8', function(errors) {
					if (errors) {
						console.error(errors);
					} else {
						delete require.cache[require.resolve(currentTemplateFilePath)];
						let currentTemplate = require(currentTemplateFilePath);
						let result = currentTemplate.main(mockData).then(function(result){handleResult(result, filePath, lastTime)}, handleError);
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

	/** gets the generic mock data for use in the provided template scope **/
	function readMockData(mockPath) {
		let mockFilePath = mockPath + '/mock.json';
		if (fs.existsSync(mockFilePath)) {
			let mockDataContent = fs.readFileSync(mockFilePath, "utf8");
			let mockData = JSON.parse(mockDataContent);
			let baseData = copyProperties({}, defaultData);
			return copyProperties(baseData, mockData);
		}
		return defaultData;
	}

	/** makes a copy of object a and copy object b's properties to the result **/
	function copyProperties(target, source) {
		for (var property in source) {
			target[property] = source[property];
		}
		return target;
	}

	/** replaces all matches using regex with replace **/
	function replaceAll(text, regex, replace) {
		if (regex.test(text)) {
			return replaceAll(text.replace(regex, replace), regex, replace);
		}
		return text;
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
		/*let pathParts = path.dirname(targetFile).split(path.sep);
		if (pathParts.pop() == 'htlmock') {
			targetFile = pathParts.join(path.sep) + '/' + path.basename(fileName);
		}*/

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

		let models = findFilesInDir(path.dirname(templateFile) + '/htlmock', '');
		for (var j = 0; j < models.length; j++) {
			copiesLeft++;
			copyFile(models[j], fileCopied);
		}

		let targetFile = copyFile(templateFile, fileCopied);
		templatesToCompile.push(targetFile);
	}
};

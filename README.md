A wrapper npm module using @adobe/htlengine to parse multiple HTL files from a directory and copy the results to a target directory

npm install mass-htl
Usage: node mass-htl <source dir> <target dir>
Will compile all .html files inside source dir and subdirectories and put the results in target dir using the same structure from the source dir path.

Example:
node compile.js src compiled 
+ myproject
	+ src
		+ banana
			- htlmock
			- banana.html
		- apple.html
	- compile.js
Will result in:
+ myproject
	- src
	+ compiled
		+ banana
			- banana.html
		- apple.html
	- compile.js

Sling models used throught data-sly-use will need to be in the a /htlmock subdirectory of the .html file.
Example:
Directory
+ myproject
	+ src
		+ htlmock
			- code.banana.BananaSlingModel.js
		- banana.html
	- compile.js
Contents of banana.html:
<sly data-sly-use.content="code.banana.BananaSlingModel"/>
<div>${content.title}</div>

Contents of code.banana.BananaSlingModel.js:
module.exports = class MyUseClass {
  use() {
	console.log(global.process.argv);
    return {
      title: 'Banana'
    };
  }
};

run the following command from the /myproject directory:
node mass-htl src compiled.

After compilation the following file will appear: /myproject/compiled/banana.html
It will contain:

<div>Banana</div>

Note: If you want to be able to use data-sly-include, you will have to target the jcr_root/apps/ aem folder.
You can only use data-sly-include on components that exist in the same module.
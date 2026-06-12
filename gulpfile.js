const path = require('path');
const { task, src, dest } = require('gulp');

// Copy every node/credential SVG/PNG icon into dist/, preserving the
// source folder layout so n8n can find each node's icon next to its
// compiled .node.js file.
task('build:icons', copyIcons);

function copyIcons() {
	// `encoding: false` is REQUIRED on gulp 5: src() otherwise decodes files
	// as UTF-8, which corrupts binary images (PNG icons end up mangled).
	const nodeSource = path.resolve('nodes', '**', '*.{png,svg}');
	const nodeDestination = path.resolve('dist', 'nodes');
	src(nodeSource, { encoding: false }).pipe(dest(nodeDestination));

	const credSource = path.resolve('credentials', '**', '*.{png,svg}');
	const credDestination = path.resolve('dist', 'credentials');
	return src(credSource, { allowEmpty: true, encoding: false }).pipe(dest(credDestination));
}

const path = require('path');
const { task, src, dest } = require('gulp');

// Copy every node/credential SVG/PNG icon into dist/, preserving the
// source folder layout so n8n can find each node's icon next to its
// compiled .node.js file.
task('build:icons', copyIcons);

function copyIcons() {
	const nodeSource = path.resolve('nodes', '**', '*.{png,svg}');
	const nodeDestination = path.resolve('dist', 'nodes');
	src(nodeSource).pipe(dest(nodeDestination));

	const credSource = path.resolve('credentials', '**', '*.{png,svg}');
	const credDestination = path.resolve('dist', 'credentials');
	return src(credSource, { allowEmpty: true }).pipe(dest(credDestination));
}

var rollup = require('broccoli-rollup');
var merge = require('broccoli-merge-trees');
var babel = require('rollup-plugin-babel');
var Funnel = require('broccoli-funnel');
var replace = require('broccoli-string-replace');
var relative = require('require-relative');
var path = require('path');
var wrapFiles = require('broccoli-wrap');

var es5Prefix = 'var module = { exports: {}};';
var es5Postfix = 'exports["default"] = module.exports';

function shouldAddRuntimeDependencies() {
  var current = this;
  var app;

  // Keep iterating upward until we don't have a grandparent.
  // Has to do this grandparent check because at some point we hit the project.
  do {
    app = current.app || app;
  } while (current.parent.parent && (current = current.parent));

  var isTopLevelAddon = false;
  for (var i = 0; i < this.project.addons.length; i++) {
    var addon = this.project.addons[i];
    isTopLevelAddon = isTopLevelAddon || addon.name === this.name;
  }

  // If this addon isn't included directly by the app, all bets are off
  // If the addon is included directly in the app, only import dependencies
  // if this instance is the top level instance
  return !isTopLevelAddon || !this.parent.parent;
}

module.exports = function(modules, indexObj) {
  var runtimeDependencies = modules.map(function(moduleName) {
    return {
      fileName: moduleName.split('/').pop() + '.js',
      moduleName: moduleName
    };
  });

  function treeForAddon(root) {
    if (shouldAddRuntimeDependencies.call(this)) {
      var trees = runtimeDependencies.map(function(dep) {
        var esNext = true;
        var pkg = require(dep.moduleName + '/package.json');
        var main = pkg['jsnext:main']
        if (!main) {
          main = pkg.main;
          esNext = false;
        }

        var babelrcPath = path.dirname(main) + '/.babelrc';

        // Hacky way of getting the npm dependency folder
        var depFolder = path.dirname(require.resolve(dep.moduleName + '/package.json'));

        // Add the babelrc file
        var babelRc = new Funnel(__dirname, {
          include: ['rollup.babelrc'],
          getDestinationPath: function(relativePath) {
            if (relativePath === 'rollup.babelrc') {
              return babelrcPath;
            }
            return relativePath;
          }
        });

        var preset = path.dirname(relative.resolve('babel-preset-es2015/package.json', __dirname));

        // Add an absolute path to the es2015 preset. Needed since host app
        // won't have the preset
        var mappedBabelRc = replace(babelRc, {
          files: [ babelrcPath ],
          pattern: {
            match: /es2015/g,
            replacement: preset
          }
        });

        var moduleDir = path.dirname(dep.moduleName);

        var target;

        if (esNext) {
          target = new rollup(merge([
            depFolder,
            mappedBabelRc
          ]), {
            rollup: {
              entry: main,
              targets: [{
                dest: dep.fileName,
                format: 'es',
                moduleId: dep.moduleName
              }],
              plugins: [
                babel()
              ]
            }
          });
        } else {
          // If not ES6, bail out
          var wrapped = wrapFiles(depFolder, { wrapper: [es5Prefix, es5Postfix] });
          target = new Funnel(wrapped, {
            getDestinationPath: function(relativePath) {
              if (relativePath === main) {
                return dep.fileName;
              }
              return relativePath;
            }
          });
        }

        if (moduleDir === '.') {
          return target;
        } else {
          return new Funnel(target, {
            destDir: moduleDir
          });
        }
      });

      var runtimeNpmTree = merge(trees.filter(Boolean));

      return this._super.treeForAddon.call(this, merge([runtimeNpmTree, root].filter(Boolean)));
    } else {
      return this._super.treeForAddon.call(this, root);
    }
  }

  if (indexObj.treeForAddon) {
    indexObj.treeForAddon = function() {
      return merge([
        indexObj.treeForAddon.apply(this, arguments),
        treeForAddon.apply(this, arguments)
      ]);
    }
  } else {
    indexObj.treeForAddon = treeForAddon;
  }

  return indexObj;
}

const fs = require('fs');
const path = require('path');

// The installer scripts live as real .ps1/.sh files under templates/ rather
// than as JS template literals. Shell syntax is full of ${...} and backticks,
// which JS template strings try to interpolate — keeping them as plain files
// removes a whole class of escaping bugs and lets them be linted directly
// with `bash -n` / PSScriptAnalyzer.
const TEMPLATE_DIR = path.join(__dirname, 'templates');

function buildPowerShellInstaller() {
  return fs.readFileSync(path.join(TEMPLATE_DIR, 'install.ps1'), 'utf8');
}

function buildBashInstaller() {
  return fs.readFileSync(path.join(TEMPLATE_DIR, 'install.sh'), 'utf8');
}

module.exports = { buildPowerShellInstaller, buildBashInstaller };

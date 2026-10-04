/**
 * [INPUT]: Depends only on the file path electron-builder hands to its onNodeModuleFile hook while collecting production node_modules
 * [OUTPUT]: Returns true for every TypeScript declaration file (.d.ts, .d.cts, .d.mts) so electron-builder force-includes it instead of applying its default "d.ts" extension exclusion
 * [POS]: Packaging hook referenced by electron-builder.yml; the packaged App GUI compiler typechecks author source against typescript/lib and package declarations inside the ASAR, so stripping them (the electron-builder default) leaves every packaged compile dead at "Cannot find global type 'Array'"
 */

/* global module */

"use strict";

const DECLARATION_FILE = /\.d\.(?:c|m)?ts$/;

function keepNodeModuleTypes(file) {
  return DECLARATION_FILE.test(file);
}

module.exports = keepNodeModuleTypes;
module.exports.default = keepNodeModuleTypes;

const { build } = require('./package.json');
const { signingConfig } = require('./scripts/desktop-signing.cjs');
const signing = signingConfig();

// Credentials stay in the environment; never put private material in this object.
module.exports = {
  ...build,
  ...signing,
  win: { ...build.win, ...signing.win },
  mac: { ...build.mac, ...signing.mac },
};

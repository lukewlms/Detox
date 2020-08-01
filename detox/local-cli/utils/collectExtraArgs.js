const _ = require('lodash');
const booleanJestArgs = _(require('jest-cli/build/cli/args'))
  .thru(args => args.options)
  .pickBy(({ type }) => type === 'boolean')
  .thru(collectIgnoredArgs)
  .value();

function collectIgnoredArgs(builder) {
  return Object.entries(builder).reduce(
    (set, [key, option]) => {
      if (option.alias) {
        if (Array.isArray(option.alias)) {
          for (const value of option.alias) {
            set.add(value);
          }
        } else {
          set.add(option.alias);
        }
      }

      return set.add(key);
    },
    new Set()
  );
}

function fixJestSingletonFlags(argv) {
  const result = {};
  const passthrough = [];

  for (const entry of Object.entries(argv)) {
    const [key, value] = entry;
    if (key === '_') {
      continue;
    }

    const positiveKey = key.startsWith('no-') ? key.slice(3) : key;
    if (booleanJestArgs.has(positiveKey) && typeof value !== 'boolean') {
      result[positiveKey] = key === positiveKey;
      passthrough.push(value);
    } else {
      result[key] = value;
    }
  }

  result._ = passthrough.concat(argv._);
  return result;
}

function fixMochaSingletonFlags(argv) {
  return argv;
}

module.exports = {
  collectIgnoredArgs,
  fixJestSingletonFlags,
  fixMochaSingletonFlags,
};

const fs = require('fs-extra');
const environment = require('../../src/utils/environment');

function clearDeviceRegistryLockFile(platform) {
  const lockFilePath = platform === 'ios'
    ? environment.getDeviceLockFilePathIOS()
    : environment.getDeviceLockFilePathAndroid();

  fs.ensureFileSync(lockFilePath);
  fs.writeFileSync(lockFilePath, '[]');
}

function getPlatformSpecificString(platform) {
  switch (platform) {
    case 'ios': return ':android:';
    case 'android': return ':ios:';
    default: return undefined;
  }
}

function printEnvironmentVariables(envObject) {
  return Object.entries(envObject).reduce((cli, [key, value]) => {
    if (value == null || value === '') {
      return cli;
    }

    return `${cli}${key}=${JSON.stringify(value)} `;
  }, '');
}

module.exports = {
  clearDeviceRegistryLockFile,
  getPlatformSpecificString,
  printEnvironmentVariables,
};

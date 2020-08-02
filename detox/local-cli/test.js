const _ = require('lodash');
const path = require('path');
const cp = require('child_process');
const fs = require('fs-extra');
const unparse = require('yargs-unparser');
const DetoxRuntimeError = require('../src/errors/DetoxRuntimeError');
const environment = require('../src/utils/environment');

const log = require('../src/utils/logger').child({ __filename });
const shellQuote = require('./utils/shellQuote');
const { clearDeviceRegistryLockFile, getPlatformSpecificString, printEnvironmentVariables } = require('./utils/misc');
const splitArgv = require('./utils/splitArgv');
const { composeDetoxConfig } = require('../src/configuration');

module.exports.command = 'test';
module.exports.desc = 'Run your test suite with the test runner specified in package.json';
module.exports.builder = require('./utils/testCommandArgs');
module.exports.handler = async function test(argv) {
  const { detoxArgs, runnerArgs } = splitArgv.detox(argv);
  const { cliConfig, deviceConfig, runnerConfig } = await composeDetoxConfig({ argv: detoxArgs });
  const [ platform ] = deviceConfig.type.split('.');
  const hasMultipleWorkers = cliConfig.workers != 1;
  let retries = argv.retries;

  const prepareArgs = (function () {
    if (runnerConfig.testRunner.includes('mocha')) {
      if (cliConfig.workers != 1) {
        log.warn('Can not use -w, --workers. Parallel test execution is only supported with iOS and Jest');
      }

      return prepareMochaArgs;
    }

    if (runnerConfig.testRunner.includes('jest')) {
      if (platform === 'android' && hasMultipleWorkers) {
        log.warn('Multiple workers is an experimental feature on Android and requires an emulator binary of version 28.0.16 or higher. ' +
          'Check your version by running: $ANDROID_HOME/tools/bin/sdkmanager --list');
      }

      return prepareJestArgs;
    }

    throw new DetoxRuntimeError({
      message: `"${runnerConfig.testRunner}" is not supported in Detox CLI tools.`,
      hint: `You can still run your tests with the runner's own CLI tool`,
    });
  }());

  function prepareMochaArgs() {
    const { specs, passthrough } = splitArgv.mocha(runnerArgs);
    const configParam = path.extname(runnerConfig.runnerConfig) === '.opts'
      ? 'opts'
      : 'config';

    const oo = {
      argv: {
        [configParam]: runnerConfig.runnerConfig || undefined,
        cleanup: Boolean(cliConfig.cleanup) || undefined,
        colors: !cliConfig.noColor && undefined,
        configuration: cliConfig.configuration || undefined,
        gpu: cliConfig.gpu || undefined,
        // TODO: check if we can --grep from user
        grep: platform ? getPlatformSpecificString(platform) : undefined,
        invert: Boolean(platform) || undefined,
        headless: Boolean(cliConfig.headless) || undefined,
        loglevel: cliConfig.loglevel || undefined,
        reuse: cliConfig.reuse || undefined,
        'artifacts-location': cliConfig.artifactsLocation || undefined,
        'config-path': cliConfig.configPath || undefined,
        'debug-synchronization': isFinite(cliConfig.debugSynchronization) ? cliConfig.debugSynchronization : undefined,
        'device-name': cliConfig.deviceName || undefined,
        'force-adb-install': platform === 'android' && cliConfig.forceAdbInstall || undefined,
        'record-logs': cliConfig.recordLogs || undefined,
        'record-performance': cliConfig.recordPerformance || undefined,
        'record-videos': cliConfig.recordVideos || undefined,
        'take-screenshots': cliConfig.takeScreenshots || undefined,
        'use-custom-logger': cliConfig.useCustomLogger || undefined,

        ...passthrough,
      },
      env: _.pick(cliConfig, ['deviceLaunchArgs']),
      specs,
    };

    return oo;
  }

  function prepareJestArgs() {
    const { specs, passthrough } = splitArgv.jest(runnerArgs);

    return {
      argv: {
        color: !cliConfig.noColor && undefined,
        config: runnerConfig.runnerConfig || undefined,
        testNamePattern: platform ? shellQuote(`^((?!${getPlatformSpecificString(platform)}).)*$`) : undefined,
        maxWorkers: cliConfig.workers,

        ...passthrough,
      },

      env: _.omitBy({
        DETOX_START_TIMESTAMP: Date.now(),
        ..._.pick(cliConfig, [
          'configPath',
          'configuration',
          'loglevel',
          'cleanup',
          'reuse',
          'debugSynchronization',
          'gpu',
          'headless',
          'artifactsLocation',
          'recordLogs',
          'takeScreenshots',
          'recordVideos',
          'recordPerformance',
          'recordTimeline',
          'deviceName',
          'deviceLaunchArgs',
          'useCustomLogger',
          'forceAdbInstall',
        ]),
        readOnlyEmu: platform === 'android' ? hasMultipleWorkers : undefined,
        reportSpecs: _.isUndefined(cliConfig.jestReportSpecs)
          ? !hasMultipleWorkers
          : `${cliConfig.jestReportSpecs}` === 'true',
      }, _.isUndefined),

      specs,
    };
  }

  const forwardedArgs = prepareArgs();
  if (!cliConfig.keepLockFile) {
    clearDeviceRegistryLockFile(platform);
  }

  let launchError;

  do {
    try {
      launchTestRunner(forwardedArgs);
      launchError = null;
    } catch (e) {
      launchError = e;

      const lastFailedTxt = environment.getLastFailedTestsPath();
      const lastFailedTests = fs.existsSync(lastFailedTxt)
        ? fs.readFileSync(lastFailedTxt, 'utf8')
        : '';

      if (!lastFailedTests) {
        throw e;
      }

      log.error('Test run has failed for the following specs:\n' + lastFailedTests);
      forwardedArgs.specs = lastFailedTests.split('\n');
    }
  } while (launchError && retries-- > 0);


  if (launchError) {
    throw launchError;
  }

  function launchTestRunner({ argv, env, specs }) {
    const command = unparse({
      _: [ ...argv._, ...specs ],
      ...argv,
    }, {
      command: runnerConfig.testRunner,
    }).join(' ');

    log.info(printEnvironmentVariables(env) + command);
    cp.execSync(command, {
      cwd: path.join('node_modules', '.bin'),
      stdio: 'inherit',
      env: {
        ...process.env,
        ...env,
      }
    });
  }
};

import os from 'os';
import crypto from 'crypto';

import cacache from 'cacache';
import serialize from 'serialize-javascript';
import findCacheDir from 'find-cache-dir';
import pLimit from 'p-limit';

import getConfigForFile from './utils/get-config-for-file';
import runImagemin from './utils/run-imagemin';

function minify(tasks = [], options = {}) {
  if (tasks.length === 0) {
    return [];
  }

  const cpus = os.cpus() || { length: 1 };
  const limit = pLimit(options.maxConcurrency || Math.max(1, cpus.length - 1));

  let cacheDir = null;
  let imageminVersion = null;
  let packageVersion = null;

  if (options.cache) {
    cacheDir =
      options.cache === true
        ? findCacheDir({ name: 'imagemin-webpack' }) || os.tmpdir()
        : options.cache;

    try {
      // eslint-disable-next-line global-require
      imageminVersion = require('imagemin/package.json').version;
    } catch (ignoreError) {
      /* istanbul ignore next */
      imageminVersion = 'unknown';
      // Nothing
    }

    try {
      // eslint-disable-next-line global-require
      packageVersion = require('../package.json').version;
    } catch (ignoreError) {
      /* istanbul ignore next */
      packageVersion = 'unknown';
      // Nothing
    }
  }

  return Promise.all(
    tasks.map((task) =>
      limit(async () => {
        const { input, filename } = task;
        const result = {
          input,
          filename,
          output: input,
          warnings: [],
          errors: [],
        };

        if (!result.input) {
          result.errors.push(new Error('Empty input'));

          return result;
        }

        // Ensure that the contents i have are in the form of a buffer
        result.input = Buffer.isBuffer(input) ? input : Buffer.from(input);

        if (options.filter && !options.filter(result.input, filename)) {
          result.filtered = true;

          return result;
        }

        const minimizerOptions = getConfigForFile(options, result);

        let cacheKey;
        let output;

        if (options.cache) {
          cacheKey = serialize({
            hash: crypto.createHash('md4').update(result.input).digest('hex'),
            imagemin: imageminVersion,
            'imagemin-options': minimizerOptions,
            'imagemin-webpack': packageVersion,
          });

          try {
            output = (await cacache.get(cacheDir, cacheKey)).data;
          } catch (ignoreError) {
            // No cache found
          }
        }

        if (output) {
          result.output = output;

          return result;
        }

        try {
          output = await runImagemin(result.input, minimizerOptions);

          result.output = output;

          if (options.cache) {
            await cacache.put(cacheDir, cacheKey, output);
          }
        } catch (error) {
          const errored = error instanceof Error ? error : new Error(error);

          if (options.bail) {
            result.errors.push(errored);
          } else {
            result.warnings.push(errored);
          }
        }

        return result;
      })
    )
  );
}

module.exports = minify;

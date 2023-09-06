
import {Transform} from 'stream';

import {SvgSpriteGroup} from './svgSprite.js';

const pluginName = 'gulp-plugin-svg-sprite';


/**
 * svg 精靈串流。
 *
 * @func svgSpriteTransform
 * @return {stream.Transform}
 */
export default function svgSpriteTransform() {
  const svgSpriteGroup = new SvgSpriteGroup();

  return new Transform({
    transform(file, encoding, callback) {
      const {cwd, base, path} = file;
      svgSpriteGroup.add(cwd, base, path);
      callback(null);
    },
    async flush(callback) {
      try {
        const iterator = svgSpriteGroup.generator();
        for await (const info of iterator) {
          const {spriteFile, scssFile} = info;
          this.push(spriteFile);
          this.push(scssFile);
        }
        callback(null);
      } catch (err) {
        err.plugin = pluginName;
        this.emit('error', err);
      }
    },
    objectMode: true,
  });
}


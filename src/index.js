
import fsPromises from 'fs/promises';
import path from 'path';
import {Transform} from 'stream';
import util from 'util';

import Vinyl from 'vinyl';
import PluginError from 'plugin-error';
import SVGSpriter from 'svg-sprite';
import imageSize from 'image-size';


const __dirname = path.join(import.meta.url.substring(5), '..');
const _templatePath = path.join(__dirname, 'svgSpriteTmpl.scss');

const pluginName = 'gulp-plugin-svg-sprite';
const mimeForImage = {
  'svg': 'image/svg+xml',
  'gif': 'image/gif',
  'jpg': 'image/jpeg',
  'png': 'image/png',
  'webp': 'image/webp',
};


/**
 * svg 精靈。
 *
 * @func svgSprite
 * @return {stream.Transform}
 */
export default function svgSprite() {
  let groupMap = new Map();
  return new Transform({
    transform(file, encoding, callback) {
      try {
        let [groupDirPath, fileInfo] = _resolveFileInfo(file);
        if (groupMap.has(groupDirPath)) {
          groupMap.get(groupDirPath).list.push(fileInfo);
        } else {
          groupMap.set(groupDirPath, {
            groupDirPath,
            cwdPath: file.cwd,
            basePath: file.base,
            list: [fileInfo],
          });
        }
        callback(null);
      } catch (err) {
        this.emit('error', new PluginError(pluginName, err));
      }
    },
    async flush(callback) {
      try {
        let outputList = await Promise.all(
          Array.from(groupMap.values())
            .map(info => _handleInputFiles(info, _templatePath)),
        );
        outputList
          .reduce((accu, files) => (accu.push(...files), accu), [])
          .forEach(file => this.push(file))
        ;
        callback(null);
      } catch (err) {
        this.emit('error', new PluginError(pluginName, err));
      }
    },
    objectMode: true,
  });
}

function _resolveFileInfo({path: filePath, contents}) {
  let {type, width, height} = imageSize(contents);
  if (!(type in mimeForImage)) {
    throw Error(`svgSprite can't handle "${type}" type of picture.`);
  }

  let groupDirPath = path.dirname(filePath);
  let fileInfo = {
    type,
    mime: mimeForImage[type],
    width,
    height,
    volume: width * height,
    path: filePath,
  };
  return [groupDirPath, fileInfo];
}

async function _handleInputFiles(
  {groupDirPath, cwdPath, basePath, list},
  templatePath,
) {
  let vinylFiles = await _createVinyls(
    cwdPath,
    // NOTE: 替換 basePath 的位置，因為會影響 css 內的名稱
    groupDirPath,
    list,
  );

  let dirPathPart = path.relative(basePath, path.dirname(groupDirPath));
  let fileBaseName = path.basename(groupDirPath);

  let {sprite: spriteFile, scss: scssFile} = await _callSvgSprite(
    _createSvgSpriteConfig(templatePath, basePath, dirPathPart, fileBaseName),
    vinylFiles,
  );

  spriteFile.base = scssFile.base = basePath;
  spriteFile.path = path.join(basePath, dirPathPart, fileBaseName + '.svg'),
  scssFile.path = path.join(basePath, dirPathPart, `_${fileBaseName}.scss`);
  return [spriteFile, scssFile];
}

function _createSvgSpriteConfig(
  templatePath, basePath, dirPathPart, fileBaseName,
) {
  return {
    dest: basePath,
    shape: {
      // css 命名
      id: {
        separator: '--',
        whitespace: '-',
      },
      spacing: {
        padding: 2,
      },
      transform: ['svgo'],
    },
    mode: {
      css: {
        // NOTE: 最後 css, svg 路徑都會被覆蓋
        // css 文件目錄路徑
        dest: path.join(basePath, dirPathPart),
        // SVG 文件路徑
        sprite: path.join(basePath, dirPathPart, fileBaseName),
        render: {
          scss: {
            template: templatePath,
          },
        },
      },
    },
    variables: {
      // SVG 圖片文件改為網站的絕對路徑
      imgFileName: `${fileBaseName}.svg`,
      precision: function () {
        return function (text, render) {
          let txt = render(text);
          let transTxt = parseFloat(parseFloat(txt).toFixed(3)).toString();
          return transTxt;
        };
      },
      // NOTE: 切除避免誤差額外設置緩衝邊距 (shape.spacing.padding)。
      trimPadding: function () {
        // return function(text, render) {
          // let txt = render(text);
          // let transTxt = parseFloat(parseFloat(txt).toFixed(3)).toString();
          // return transTxt;
        // };
        return function (text, render) {
          let txt = render(text);
          let transTxt
            = parseFloat((parseFloat(txt) - 6).toFixed(3)).toString();
          return transTxt;
        };
      },
      jsEval: function () {
        return function (text, render) {
          let txt = eval(render(text));
          let transTxt = parseFloat(txt.toFixed(3)).toString();
          return transTxt;
        };
      },
    },
  };
}

async function _createVinyls(cwdPath, basePath, list) {
  return await Promise.all(
    list
      .sort((prev, next) => prev.volume - next.volume)
      .map(({type, mime, width, height, path: filePath_}) => (async _ => {
        let filePath = filePath_;
        let contents = await fsPromises.readFile(filePath);
        if (type !== 'svg') {
          contents = _convertSvgFile(mime, width, height, contents);
          let pathParse = path.parse(filePath);
          filePath = path.join(pathParse.dir, pathParse.name + '.svg');
        }
        return new Vinyl({
          cwd: cwdPath,
          base: basePath,
          path: filePath,
          contents,
        });
      })()),
  );
}

function _convertSvgFile(mime, width, height, fileBuffer) {
  let base64Data = fileBuffer.toString('base64');
  let svgFileText = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      version="1.1"
      viewBox="0 0 ${width} ${height}"
      width="${width}"
      height="${height}">
      <image xlink:href="data:${mime};base64,${base64Data}" />
    </svg>
  `.replace(/\n/g, '').replace(/(>)? +(<)?/g, '$1 $2');
  return Buffer.from(svgFileText);
}

function _callSvgSprite(options, fileList) {
  return new Promise(function (resolve, reject) {
    let isFail = false;

    let spriter = new SVGSpriter(options);
    spriter.config.log.error = function (...args) {
      isFail = true;
      let errMsg = util.format(...args);
      reject(new Error(errMsg));
    };

    for (let idx = 0, len = fileList.length; idx < len; idx++) {
      let file = fileList[idx];
      spriter.add(file);
      if (isFail) return;
    }

    spriter.compile(function (err, result) {
      if (err) {
        reject(err);
      } else {
        // NOTE: result.<mode>.<(sprite|scss)>
        resolve(result.css);
      }
    });
  });
}


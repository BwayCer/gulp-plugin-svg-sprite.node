
import fsPromises from 'fs/promises';
import path from 'path';
import util from 'util';

import Vinyl from 'vinyl';
import SVGSpriter from 'svg-sprite';
import probeImageSize from 'probe-image-size';

const __dirname = path.join(import.meta.url.substring(5), '..');
const _templatePath = path.join(__dirname, 'svgSpriteTmpl.scss');


/**
 * @typedef {Object} OutputFiles
 * @property {Vinyl} spriteFile
 * @property {Vinyl} scssFile
 */

// @param {String} destNoExt - 最後輸出文件名為
// `${destNoExt}.scss`, `${destNoExt}.svg`。
// @return {OutputFiles}
async function _svgSpriteCompile(
  templatePath,
  cwd, base, destNoExt, filePaths,
) {
  const fileInfos = await Promise.all(
    filePaths.map(_readFileInfo),
  );
  // 因為 base 欄位會影響 css 內的名稱，故以 destNoExt 替換。
  const vinylFiles = _createVinyls(cwd, destNoExt, fileInfos);

  const directory = path.dirname(destNoExt);
  const fileName = path.basename(destNoExt);
  const config = _createSvgSpriteConfig(
    templatePath, base, directory, fileName,
  );

  const {
    sprite: spriteFile,
    scss: scssFile,
  } = await _callSvgSprite(config, vinylFiles);

  spriteFile.base = scssFile.base = base;
  spriteFile.path = path.join(directory, fileName + '.svg');
  scssFile.path = path.join(directory, `_${fileName}.scss`);
  return {spriteFile, scssFile};
}

/**
 * @typedef {Object} FileInfo
 * @property {String} type
 * @property {String} mime
 * @property {Number} width
 * @property {Number} height
 * @property {Number} volume
 * @property {String} path
 * @property {Buffer} contents
 */

/**
 * @func _readFileInfo
 * @return {FileInfo}
 */
async function _readFileInfo(filePath) {
  const contents = await fsPromises.readFile(filePath);

  // 分析圖片訊息
  const imageSizeInfo = probeImageSize.sync(contents);
  if (imageSizeInfo === null) {
    throw Error(`svgSprite unrecognized image for "${filePath}".`);
  }
  const {type, mime, width, height} = imageSizeInfo;

  return {
    type,
    mime,
    width,
    height,
    volume: width * height,
    path: filePath,
    contents: contents,
  };
}

function _createVinyls(cwd, base, fileInfos) {
  return fileInfos
    .sort((prev, next) => prev.volume - next.volume)
    .map(fileInfo => {
      let {type, path: filePath, contents} = fileInfo;
      if (type !== 'svg') {
        const {mime, width, height} = fileInfo;
        const pathParse = path.parse(filePath);
        filePath = path.join(pathParse.dir, pathParse.name + '.svg');
        contents = _convertSvgFile(mime, width, height, contents);
      }
      return new Vinyl({
        cwd,
        base,
        path: filePath,
        contents,
      });
    })
  ;
}

function _convertSvgFile(mime, width, height, fileBuffer) {
  let base64Data = fileBuffer.toString('base64');
  let svgFileText = '<svg'
    + ' xmlns="http://www.w3.org/2000/svg"'
    + ' xmlns:xlink="http://www.w3.org/1999/xlink"'
    + ' version="1.1"'
    + ` viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + `<image xlink:href="data:${mime};base64,${base64Data}" />`
    + '</svg>';
  return Buffer.from(svgFileText);
}

function _createSvgSpriteConfig(templatePath, base, directory, fileName) {
  return {
    dest: base,
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
        dest: directory,
        // SVG 文件路徑
        sprite: path.join(directory, fileName),
        render: {
          scss: {
            template: templatePath,
          },
        },
      },
    },
    variables: {
      // SVG 圖片文件改為網站的絕對路徑
      imgFileName: `${fileName}.svg`,
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


/**
 * svg 精靈。
 *
 * @func svgSprite
 * @return {OutputFiles}
 */
export async function svgSprite(cwd, base, destNoExt, filePaths) {
  return _svgSpriteCompile(
    _templatePath,
    cwd, base, destNoExt, filePaths,
  );
}

/**
 * @func svgSpriteGenerator
 * @return {Generator}
 */
export async function* svgSpriteGenerator(groups) {
  // 一個群組一個群組的處理，避免記憶體負載過大。
  for (const group of groups) {
    const {cwd, base, destNoExt, list: filePaths} = group;
    const {spriteFile, scssFile} = await _svgSpriteCompile(
      _templatePath,
      cwd, base, destNoExt, filePaths,
    );

    const id = destNoExt.startsWith(base)
      ? path.relative(base, destNoExt)
      : destNoExt
    ;

    yield {id, cwd, base, spriteFile, scssFile};
  }
}

export class SvgSpriteGroup {
  groupMap = new Map();

  /**
   * @memberof svgSprite#
   * @func add
   * @param {Object} file
   * @param {String} file.cwd
   * @param {String} file.base
   * @param {String} file.path
   */
  add(cwd, base, filePath) {
    // 圖片依目錄分類
    const groupDirPath = path.dirname(filePath);
    if (this.groupMap.has(groupDirPath)) {
      this.groupMap.get(groupDirPath).list.push(filePath);
    } else {
      this.groupMap.set(groupDirPath, {
        cwd,
        base,
        destNoExt: groupDirPath,
        list: [filePath],
      });
    }
  }

  /**
   * @memberof svgSprite#
   * @func generator
   * @return {Generator}
   */
  generator() {
    return svgSpriteGenerator(this.groupMap.values());
  }
}


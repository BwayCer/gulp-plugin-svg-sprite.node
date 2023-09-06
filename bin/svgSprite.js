#!/usr/bin/env node

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

import minimist from 'minimist';
import multimatch from 'multimatch';

import {SvgSpriteGroup} from '../src/index.js';

const _filename = import.meta.url.substring(7);
const _fileName = path.basename(_filename); // _fileName


// findFileGenerator ---

async function* findFileGenerator(startDirPath, options) {
  const base = options?.base ?? startDirPath;
  const isFollowLink = options?.isFollowLink !== false;

  const iterator = _findFileGenerator(startDirPath, {base, isFollowLink});
  for await (const info of iterator) {
    yield info;
  }
}
async function* _findFileGenerator(startDirPath, options, parentLinkDirInfos) {
  const childNames = await fsPromises.readdir(startDirPath);
  const {base, isFollowLink} = options;

  let startDirRealpath = null;
  for (const fileName of childNames) {
    const filePath = path.join(startDirPath, fileName);
    const info = await _fileBaseInfoForFind(base, filePath);

    if (info !== undefined) {
      const {id, isFile, isDirectory, isSymbolicLink} = info;

      if (isFile) {
        yield {
          id,
          path: filePath,
          isParentSymbolicLink: parentLinkDirInfos !== undefined,
          isSymbolicLink,
        };
      } else if (isDirectory && (!isSymbolicLink || isFollowLink)) {
        let _parentLinkDirInfos = parentLinkDirInfos;
        if (isSymbolicLink) {
          if (startDirRealpath === null) {
            startDirRealpath = await fsPromises.realpath(startDirPath);
          }

          // 若為指向目錄的鏈結，需檢查是否參考父層及本次的位置，以避免循環引用。
          _parentLinkDirInfos = [
            ...(parentLinkDirInfos ?? []),
            {
              id,
              real: path.join(startDirRealpath, fileName) + '/',
            },
          ];
          const fileRealPath = (await fsPromises.realpath(filePath)) + '/';
          const circularRefInfo = _parentLinkDirInfos.find(
            ({real}) => real.startsWith(fileRealPath),
          );
          if (circularRefInfo !== undefined) {
            throw new Error(`The symbolic link from "${id}" to "${circularRefInfo.id}" or its parent path causes a circular reference.`);
          }
        }

        const iterator = _findFileGenerator(
          filePath,
          options,
          _parentLinkDirInfos,
        );
        for await (const info of iterator) {
          yield info;
        }
      }
    }
  }
}
async function _fileBaseInfoForFind(base, filePath) {
  const id = path.relative(base, filePath);

  const fileStat = await fsPromises.stat(filePath);
  const filelStat = await fsPromises.lstat(filePath);

  const isFile = fileStat.isFile();
  const isDirectory = fileStat.isDirectory();
  const isSymbolicLink = filelStat.isSymbolicLink();
  if (isDirectory || isFile) {
    return {
      id,
      isFile,
      isDirectory,
      isSymbolicLink,
    };
  }
}


// run ---

const cmdArgv = minimist(process.argv.slice(2));

if (cmdArgv.h === true || cmdArgv.help === true) {
  console.log(
    `Usage: ${_fileName} [OPTION]`
    + '\n\nOptions:'
    + '\n  -s, --src <path>   origin directory. (default: `process.cwd()`)'
    + '\n  -t, --to <path>    dist directory. (default: "./dist")'
    + '\n  -h, --help         display this help'
    + '\n',
  );
  process.exit();
}

cmdArgv.src = cmdArgv.src ?? cmdArgv.s ?? '';
cmdArgv.to = cmdArgv.to ?? cmdArgv.t ?? 'dist';

const cwd = process.cwd();
const base = path.resolve(cmdArgv.src);
const dest = path.resolve(cmdArgv.to);
const globs = '**/*.{svg,gif,jpg,png,webp,avif}';
const isForce = true;

const sprite = new SvgSpriteGroup();

const _showIds = [];
for await (const {id, path: filePath} of findFileGenerator(base)) {
  if (multimatch(id, globs).length > 0) {
    const groupDirPath = path.dirname(id);
    if (!~_showIds.indexOf(groupDirPath)) {
      _showIds.push(groupDirPath);
      console.log('find: ' + groupDirPath);
    }
    sprite.add(cwd, base, filePath);
  }
}

for await (const {spriteFile, scssFile} of sprite.generator()) {
  const files = [spriteFile, scssFile];

  const pathParse = path.parse(spriteFile.relative);
  const fileId = path.join(pathParse.dir, pathParse.name) + '.{svg,css}';

  if (!isForce) {
    const isExistFile = files.some(
      file => fs.existsSync(path.join(dest, file.relative)),
    );
    if (isExistFile) {
      console.log('exists: ' + fileId);
      break;
    }
  }

  for (const file of files) {
    const {relative, contents} = file;

    const destPath = path.join(dest, relative);
    if (fs.existsSync(destPath)) {
      await fsPromises.rm(destPath);
    }

    const dirPath = path.dirname(destPath);
    // 如果要每層檢查是否為文件過於繁瑣，還是讓系統報錯吧
    await fsPromises.mkdir(dirPath, {recursive: true});

    await fsPromises.writeFile(destPath, contents);
  }
  console.log('output: ' + fileId);
}


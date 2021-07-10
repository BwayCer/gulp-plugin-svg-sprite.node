
import path from 'path';
import {Transform} from 'stream';

import gulp from 'gulp';
import sass from 'sass';

import gulpSvgSprite from './src/index.js';


let srcPathPart = './test/sample';
let distPathPart = './dist/sample';

export let svgSprite = gulp.series(
  () => gulp
    .src(
      srcPathPart + '/image/**/*.{svg,gif,jpg,png,webp}',
      {base: path.resolve(srcPathPart)},
    )
    .pipe(gulpSvgSprite())
    .pipe(gulp.dest(distPathPart))
  ,
  () => gulp
    .src(
      srcPathPart + '/page/index.scss',
      {base: path.resolve(srcPathPart)},
    )
    .pipe(gulpSass())
    .pipe(gulp.dest(distPathPart))
  ,
  () => gulp
    .src(
      srcPathPart + '/page/index.html',
      {base: path.resolve(srcPathPart)},
    )
    .pipe(gulp.dest(distPathPart))
  ,
);


function gulpSass() {
  return new Transform({
    transform(chunk, encoding, callback) {
      let pathParse = path.parse(chunk.path);
      let outFile = path.join(
        pathParse.dir,
        pathParse.name + '.css',
      );

      sass.render({
        outputStyle: 'expanded',
        sourceMap: false,
        file: chunk.path,
        outFile,
      }, (err, result) => {
        if (err) throw err;

        chunk.path = outFile;
        chunk.contents = result.css;
        this.push(chunk);

        callback(null);
      });
    },
    flush(callback) {
      callback(null);
    },
    objectMode: true,
  });
}


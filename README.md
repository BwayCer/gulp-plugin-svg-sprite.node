gulp-plugin-svg-sprite
=======


把多張圖示整合成一張 SVG 向量圖片的 [Gulp](https://gulpjs.com/) 程式包。

[Demo](https://bwaycer.github.io/gulp-plugin-svg-sprite.node/sample/page/index.html)



## 使用方法


**合成 SVG 圖片並生成專用的 Scss 工具：**

```
import gulpSvgSprite from '@bwaycer/gulp-plugin-svg-sprite';

// 請使用常見且瀏覽器有支援的格式
gulp.src('path/to/**/*.{svg,gif,jpg,png,webp,avif}')
  .pipe(gulpSvgSprite())
  .pipe(gulp.dest(...))
```


**使用 Scss 工具選取單張圖示：**

```
@use './path/to/scss-module' as scssModule with (
  $imgUrlDirPath: './path/to/image.svg',
);

.icon {
  --em: 16px;
  @include scssModule.icon(<iconFileName>, [(width|height)]);
}
```


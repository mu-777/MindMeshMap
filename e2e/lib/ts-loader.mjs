// src/配下の .ts/.tsx を、ビルドせずに素のNodeから直接importするためのESMローダー登録。
// このファイルをimportした時点で登録が済む（副作用import）。
//
//   import './lib/ts-loader.mjs';
//   const { calculateSugiyamaExtLayout } = await import('../src/utils/sugiyamaExtLayout.ts');
//
// **必ず動的import（await import）で読むこと**。静的importはモジュールのリンク時（＝この
// ファイルの本体が実行される前）に解決・ロードされてしまい、ローダーが間に合わない。
//
// なぜ必要か: 素のNode.jsは拡張子省略・ディレクトリindex解決（Vite/tscのbundlerモード解決）に
// 対応しておらず、型のみのimport（例: `import ELK, { ElkNode } from 'elkjs/...'`）も剥がせない。
// esbuild（vite経由で既にnode_modulesに存在する）でトランスパイルしてから実行エンジンへ渡す。
// src側の実装・importの書き方はテストのために一切変更しない（ビルド成果物ではなく開発時の
// ソースそのものを検証するため）という方針のためのしくみ。
import { register } from 'node:module';

const esbuildUrl = import.meta.resolve('esbuild');

// resolve: 拡張子省略・ディレクトリ import（'../types' → 'types/index.ts'）をesbuild実行前に解決する
// load: .ts/.tsxファイルをesbuild.transformでESMのJSに変換してから実行エンジンに渡す
const loaderSource = `
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as esbuild from ${JSON.stringify(esbuildUrl)};

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const baseDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    let resolved = path.resolve(baseDir, specifier);
    if (!path.extname(resolved)) {
      if (existsSync(resolved) && statSync(resolved).isDirectory()) {
        resolved = path.join(resolved, 'index.ts');
      } else if (existsSync(resolved + '.ts')) {
        resolved = resolved + '.ts';
      } else if (existsSync(resolved + '.tsx')) {
        resolved = resolved + '.tsx';
      }
    }
    return nextResolve(pathToFileURL(resolved).href, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const filePath = fileURLToPath(url);
    const source = readFileSync(filePath, 'utf-8');
    const result = await esbuild.transform(source, {
      loader: url.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'esm',
      target: 'es2022',
      sourcefile: filePath,
    });
    return { format: 'module', source: result.code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
const versions = {
  'package.json': pkg.version,
  'package-lock.json': lock.version,
  'package-lock.json root': lock.packages[''].version,
  'tauri.conf.json': tauri.version,
  'Cargo.toml': read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1],
  'Cargo.lock': read('src-tauri/Cargo.lock').match(/name = "paper-vocabulary"\nversion = "([^"]+)"/)?.[1],
};
if (Object.values(versions).some(value => value !== pkg.version)) {
  throw new Error(`앱과 설치 파일 버전이 다릅니다. 배포 전에 버전을 맞춰 주세요: ${JSON.stringify(versions)}`);
}
if (!tauri.app.windows[0].title.endsWith(`v${pkg.version}`)) {
  throw new Error('앱 창 제목의 버전도 현재 앱 버전과 맞춰 주세요.');
}
console.log(`Application and installer versions: ${pkg.version}`);

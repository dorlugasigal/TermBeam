// Material file icons — curated subset from material-icon-theme
// Vite resolves these as asset URLs at build time

// File icons
import iconFile from 'material-icon-theme/icons/file.svg';
import iconJs from 'material-icon-theme/icons/javascript.svg';
import iconTs from 'material-icon-theme/icons/typescript.svg';
import iconReact from 'material-icon-theme/icons/react.svg';
import iconReactTs from 'material-icon-theme/icons/react_ts.svg';
import iconJson from 'material-icon-theme/icons/json.svg';
import iconHtml from 'material-icon-theme/icons/html.svg';
import iconCss from 'material-icon-theme/icons/css.svg';
import iconMarkdown from 'material-icon-theme/icons/markdown.svg';
import iconPython from 'material-icon-theme/icons/python.svg';
import iconGo from 'material-icon-theme/icons/go.svg';
import iconRust from 'material-icon-theme/icons/rust.svg';
import iconJava from 'material-icon-theme/icons/java.svg';
import iconCsharp from 'material-icon-theme/icons/csharp.svg';
import iconCpp from 'material-icon-theme/icons/cpp.svg';
import iconC from 'material-icon-theme/icons/c.svg';
import iconDocker from 'material-icon-theme/icons/docker.svg';
import iconGit from 'material-icon-theme/icons/git.svg';
import iconYaml from 'material-icon-theme/icons/yaml.svg';
import iconToml from 'material-icon-theme/icons/toml.svg';
import iconShell from 'material-icon-theme/icons/console.svg';
import iconSql from 'material-icon-theme/icons/database.svg';
import iconNpm from 'material-icon-theme/icons/npm.svg';
import iconLock from 'material-icon-theme/icons/lock.svg';
import iconImage from 'material-icon-theme/icons/image.svg';
import iconFont from 'material-icon-theme/icons/font.svg';
import iconSettings from 'material-icon-theme/icons/settings.svg';
import iconEslint from 'material-icon-theme/icons/eslint.svg';
import iconPrettier from 'material-icon-theme/icons/prettier.svg';
import iconReadme from 'material-icon-theme/icons/readme.svg';
import iconChangelog from 'material-icon-theme/icons/changelog.svg';
import iconCertificate from 'material-icon-theme/icons/certificate.svg';
import iconTodo from 'material-icon-theme/icons/todo.svg';
import iconVue from 'material-icon-theme/icons/vue.svg';
import iconSvelte from 'material-icon-theme/icons/svelte.svg';
import iconSvg from 'material-icon-theme/icons/svg.svg';

// Folder icons
import iconFolder from 'material-icon-theme/icons/folder.svg';
import iconFolderOpen from 'material-icon-theme/icons/folder-open.svg';
import iconFolderSrc from 'material-icon-theme/icons/folder-src.svg';
import iconFolderSrcOpen from 'material-icon-theme/icons/folder-src-open.svg';
import iconFolderTest from 'material-icon-theme/icons/folder-test.svg';
import iconFolderTestOpen from 'material-icon-theme/icons/folder-test-open.svg';
import iconFolderConfig from 'material-icon-theme/icons/folder-config.svg';
import iconFolderConfigOpen from 'material-icon-theme/icons/folder-config-open.svg';
import iconFolderDocs from 'material-icon-theme/icons/folder-docs.svg';
import iconFolderDocsOpen from 'material-icon-theme/icons/folder-docs-open.svg';
import iconFolderPublic from 'material-icon-theme/icons/folder-public.svg';
import iconFolderPublicOpen from 'material-icon-theme/icons/folder-public-open.svg';
import iconFolderDist from 'material-icon-theme/icons/folder-dist.svg';
import iconFolderDistOpen from 'material-icon-theme/icons/folder-dist-open.svg';
import iconFolderComponents from 'material-icon-theme/icons/folder-components.svg';
import iconFolderComponentsOpen from 'material-icon-theme/icons/folder-components-open.svg';
import iconFolderLib from 'material-icon-theme/icons/folder-lib.svg';
import iconFolderLibOpen from 'material-icon-theme/icons/folder-lib-open.svg';
import iconFolderApi from 'material-icon-theme/icons/folder-api.svg';
import iconFolderApiOpen from 'material-icon-theme/icons/folder-api-open.svg';
import iconFolderImages from 'material-icon-theme/icons/folder-images.svg';
import iconFolderImagesOpen from 'material-icon-theme/icons/folder-images-open.svg';

// File extension → icon mapping
const extMap: Record<string, string> = {
  js: iconJs,
  mjs: iconJs,
  cjs: iconJs,
  jsx: iconReact,
  ts: iconTs,
  mts: iconTs,
  tsx: iconReactTs,
  json: iconJson,
  jsonc: iconJson,
  html: iconHtml,
  htm: iconHtml,
  css: iconCss,
  scss: iconCss,
  less: iconCss,
  md: iconMarkdown,
  mdx: iconMarkdown,
  py: iconPython,
  pyw: iconPython,
  go: iconGo,
  rs: iconRust,
  java: iconJava,
  cs: iconCsharp,
  cpp: iconCpp,
  cc: iconCpp,
  cxx: iconCpp,
  hpp: iconCpp,
  c: iconC,
  h: iconC,
  sh: iconShell,
  bash: iconShell,
  zsh: iconShell,
  fish: iconShell,
  yml: iconYaml,
  yaml: iconYaml,
  toml: iconToml,
  sql: iconSql,
  vue: iconVue,
  svelte: iconSvelte,
  svg: iconSvg,
  png: iconImage,
  jpg: iconImage,
  jpeg: iconImage,
  gif: iconImage,
  webp: iconImage,
  ico: iconImage,
  bmp: iconImage,
  woff: iconFont,
  woff2: iconFont,
  ttf: iconFont,
  otf: iconFont,
  eot: iconFont,
  ini: iconSettings,
  cfg: iconSettings,
  diff: iconGit,
  patch: iconGit,
  lock: iconLock,
};

// Special filename → icon mapping
const nameMap: Record<string, string> = {
  dockerfile: iconDocker,
  '.dockerignore': iconDocker,
  'docker-compose.yml': iconDocker,
  'docker-compose.yaml': iconDocker,
  '.gitignore': iconGit,
  '.gitattributes': iconGit,
  '.gitmodules': iconGit,
  '.npmrc': iconNpm,
  '.npmignore': iconNpm,
  'package.json': iconNpm,
  'package-lock.json': iconNpm,
  'yarn.lock': iconLock,
  'pnpm-lock.yaml': iconLock,
  '.eslintrc': iconEslint,
  '.eslintrc.js': iconEslint,
  '.eslintrc.json': iconEslint,
  'eslint.config.js': iconEslint,
  'eslint.config.mjs': iconEslint,
  '.prettierrc': iconPrettier,
  '.prettierignore': iconPrettier,
  'prettier.config.js': iconPrettier,
  'readme.md': iconReadme,
  readme: iconReadme,
  'readme.txt': iconReadme,
  'changelog.md': iconChangelog,
  changelog: iconChangelog,
  'changes.md': iconChangelog,
  'history.md': iconChangelog,
  license: iconCertificate,
  'license.md': iconCertificate,
  licence: iconCertificate,
  'licence.md': iconCertificate,
  'todo.md': iconTodo,
  todo: iconTodo,
  'todo.txt': iconTodo,
  'tsconfig.json': iconTs,
  'tsconfig.build.json': iconTs,
  makefile: iconSettings,
  gnumakefile: iconSettings,
};

// Folder name → [closed, open] icon mapping
const folderMap: Record<string, [string, string]> = {
  src: [iconFolderSrc, iconFolderSrcOpen],
  source: [iconFolderSrc, iconFolderSrcOpen],
  test: [iconFolderTest, iconFolderTestOpen],
  tests: [iconFolderTest, iconFolderTestOpen],
  __tests__: [iconFolderTest, iconFolderTestOpen],
  spec: [iconFolderTest, iconFolderTestOpen],
  config: [iconFolderConfig, iconFolderConfigOpen],
  configs: [iconFolderConfig, iconFolderConfigOpen],
  conf: [iconFolderConfig, iconFolderConfigOpen],
  docs: [iconFolderDocs, iconFolderDocsOpen],
  doc: [iconFolderDocs, iconFolderDocsOpen],
  documentation: [iconFolderDocs, iconFolderDocsOpen],
  public: [iconFolderPublic, iconFolderPublicOpen],
  static: [iconFolderPublic, iconFolderPublicOpen],
  dist: [iconFolderDist, iconFolderDistOpen],
  build: [iconFolderDist, iconFolderDistOpen],
  out: [iconFolderDist, iconFolderDistOpen],
  output: [iconFolderDist, iconFolderDistOpen],
  components: [iconFolderComponents, iconFolderComponentsOpen],
  lib: [iconFolderLib, iconFolderLibOpen],
  libs: [iconFolderLib, iconFolderLibOpen],
  utils: [iconFolderLib, iconFolderLibOpen],
  helpers: [iconFolderLib, iconFolderLibOpen],
  api: [iconFolderApi, iconFolderApiOpen],
  assets: [iconFolderImages, iconFolderImagesOpen],
  images: [iconFolderImages, iconFolderImagesOpen],
  img: [iconFolderImages, iconFolderImagesOpen],
  icons: [iconFolderImages, iconFolderImagesOpen],
};

export function getFileIconUrl(name: string, isDir: boolean, isExpanded: boolean): string {
  const lower = name.toLowerCase();

  if (isDir) {
    const mapped = folderMap[lower];
    if (mapped) return isExpanded ? mapped[1] : mapped[0];
    return isExpanded ? iconFolderOpen : iconFolder;
  }

  // Check full filename first
  if (nameMap[lower]) return nameMap[lower];

  // Check files starting with .env
  if (lower === '.env' || lower.startsWith('.env.')) return iconSettings;

  // Check files starting with dockerfile
  if (lower.startsWith('dockerfile')) return iconDocker;

  // Check eslint config variants
  if (lower.startsWith('eslint')) return iconEslint;

  // By extension
  const ext = lower.split('.').pop() || '';
  return extMap[ext] || iconFile;
}

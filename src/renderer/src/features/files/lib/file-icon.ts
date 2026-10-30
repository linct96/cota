const extensions = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'react',
  tsx: 'react',
  vue: 'vue',
  svelte: 'code',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  py: 'python',
  pyw: 'python',
  go: 'go',
  rs: 'rust',
  c: 'code',
  h: 'code',
  cpp: 'code',
  hpp: 'code',
  cs: 'code',
  java: 'code',
  kt: 'code',
  swift: 'code',
  rb: 'code',
  php: 'code',
  lua: 'code',
  sql: 'code',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yaml: 'config',
  yml: 'config',
  toml: 'config',
  ini: 'config',
  conf: 'config',
  xml: 'config',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'shell',
  bat: 'shell',
  cmd: 'shell',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  rst: 'text',
  csv: 'text',
  pdf: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  svg: 'image',
  webp: 'image',
  avif: 'image',
  ico: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  heic: 'image',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  aac: 'audio',
  opus: 'audio',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  avi: 'video',
  m4v: 'video',
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font',
  eot: 'font',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  bz2: 'archive',
  xz: 'archive',
  '7z': 'archive',
  rar: 'archive',
  jar: 'archive',
} as const

const filenames = {
  'package.json': 'npm',
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  '.npmrc': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-workspace.yaml': 'pnpm',
  'yarn.lock': 'package',
  'bun.lock': 'package',
  'bun.lockb': 'package',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.gitkeep': 'git',
  '.dockerignore': 'docker',
  dockerfile: 'docker',
  containerfile: 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  'compose.yml': 'docker',
  'compose.yaml': 'docker',
  'tsconfig.json': 'config',
  'jsconfig.json': 'config',
  '.editorconfig': 'config',
  'cargo.toml': 'rust',
  'cargo.lock': 'rust',
  'go.mod': 'go',
  'go.sum': 'go',
  'pyproject.toml': 'python',
  'requirements.txt': 'python',
  pipfile: 'python',
  makefile: 'shell',
  justfile: 'shell',
  readme: 'text',
  license: 'text',
  licence: 'text',
  notice: 'text',
  changelog: 'text',
} as const

export type FileIconKind =
  | (typeof extensions)[keyof typeof extensions]
  | (typeof filenames)[keyof typeof filenames]
  | 'declaration'
  | 'env'
  | 'file'
  | 'submodule'

export function fileIconKind(path: string, submodule = false): FileIconKind {
  if (submodule) return 'submodule'
  // Git paths use '/', while a backslash can be part of a POSIX file name.
  const name = path.split('/').pop()!.toLowerCase()
  if (Object.hasOwn(filenames, name)) return filenames[name as keyof typeof filenames]
  if (name === '.env' || name.startsWith('.env.')) return 'env'
  if (/^(?:dockerfile|containerfile)\./.test(name)) return 'docker'
  if (
    /^(?:tsconfig|jsconfig)\..+\.json$/.test(name) ||
    /^\.(?:eslint|prettier|stylelint)rc(?:\..+)?$/.test(name) ||
    /\.(?:config|conf)\.[^.]+$/.test(name)
  )
    return 'config'
  if (/\.d\.[cm]?ts$/.test(name)) return 'declaration'
  if (/\.tar\.(?:gz|bz2|xz)$/.test(name)) return 'archive'
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1) : ''
  return Object.hasOwn(extensions, extension)
    ? extensions[extension as keyof typeof extensions]
    : 'file'
}

// The browser libraries `yad brain view` ships inside the package (E177), and the proof of each one.
//
// They are VENDORED — copied byte for byte from their npm tarballs into cli/brain/vendor/ — not installed and
// not loaded from a CDN: the CLI stays zero-dependency, the page works offline, and no third party can change
// what it runs. Each record is vetted the way a toolbox entry is (cli/toolbox.mjs, E88): where the licence was
// read, the official source, the release, the npm package and version. Two more fields hold the copy itself:
//
//   file       the file's name in cli/brain/vendor/ (the page asks for /vendor/<file>; nothing else is served)
//   from       the file's path inside the npm tarball
//   tarball    the npm tarball, with its `integrity` (sha512) as npm publishes it
//   sha256     the file's own hash; the unit suite recomputes it, so a changed copy fails
//   licenceFile  the LICENSE file copied beside it, from the same tarball
//
// The unit suite holds every record complete and every hash right; `scripts/vet-check.mjs` refuses a release
// while a record is older than VET_MAX_AGE_DAYS, as for the toolbox.
//
// TO MOVE ONE: download the new tarball (`npm pack <name>@<version>`), check its sha512 against
// `npm view <name>@<version> dist.integrity`, read its LICENSE again, copy `from` and the LICENSE into
// cli/brain/vendor/, check the new file holds no `eval`, `new Function` or `</script`, then update the record
// (version, release, tarball, integrity, sha256, vetted.on). Open the page with Playwright and check the
// console shows no CSP error.

const VETTED_ON = '2026-11-13';

export const VENDORED = Object.freeze([
  {
    id: 'sigma', name: 'sigma.js', licence: 'MIT',
    file: 'sigma.min.js', from: 'package/dist/sigma.min.js', licenceFile: 'LICENSE-sigma.txt',
    sha256: '58e30383ab428f832068d9d16a5215c65ba12430d438ed091c5703f398de9e16',
    tarball: 'https://registry.npmjs.org/sigma/-/sigma-3.0.3.tgz',
    integrity: 'sha512-5H0zFlx6/NTQpqBg4Rm569ZOpnBOXMaS25UQThIWMU3XyzI5AhmorK/gnl87BvJBLhQd0tW4C0LIp3enWzMoNw==',
    vetted: {
      on: VETTED_ON,
      licenceFrom: 'https://github.com/jacomyal/sigma.js/blob/main/LICENSE.txt',
      source: 'https://github.com/jacomyal/sigma.js',
      release: 'sigma@3.0.3',
      packages: [{ registry: 'npm', name: 'sigma', version: '3.0.3' }],
      note: '3.0.3, not 4.0.6: 4.0.6 was three days old on the day of vetting',
    },
  },
  {
    id: 'graphology', name: 'graphology', licence: 'MIT',
    file: 'graphology.umd.min.js', from: 'package/dist/graphology.umd.min.js', licenceFile: 'LICENSE-graphology.txt',
    sha256: 'dc337efa23903f61e064c8e7e7f93a429e6855dccfc2458802b4ed30c621c087',
    tarball: 'https://registry.npmjs.org/graphology/-/graphology-0.26.0.tgz',
    integrity: 'sha512-8SSImzgUUYC89Z042s+0r/vMibY7GX/Emz4LDO5e7jYXhuoWfHISPFJYjpRLUSJGq6UQ6xlenvX1p/hJdfXuXg==',
    vetted: {
      on: VETTED_ON,
      licenceFrom: 'https://github.com/graphology/graphology/blob/master/src/graphology/LICENSE.txt',
      source: 'https://github.com/graphology/graphology',
      release: null,
      packages: [{ registry: 'npm', name: 'graphology', version: '0.26.0' }],
      note: null,
    },
  },
  {
    id: 'graphology-library', name: 'graphology-library (with the ForceAtlas2 layout)', licence: 'MIT',
    file: 'graphology-library.min.js', from: 'package/dist/graphology-library.min.js', licenceFile: 'LICENSE-graphology-library.txt',
    sha256: '5323729ec6d4ac5d98a245873646c27fd80c7234df13972faec5869f3c54a105',
    tarball: 'https://registry.npmjs.org/graphology-library/-/graphology-library-0.8.0.tgz',
    integrity: 'sha512-mIzyL2AxUOAi+Q6pr8/xyadMCzCZ8bTZhcGYKR4gk+QIBZQqwiE1gAfCjCSqMj5q7kyBbdCVjrPHi6kAXvu0dw==',
    vetted: {
      on: VETTED_ON,
      licenceFrom: 'https://github.com/graphology/graphology/blob/master/src/library/LICENSE.txt',
      source: 'https://github.com/graphology/graphology',
      release: null,
      packages: [{ registry: 'npm', name: 'graphology-library', version: '0.8.0' }],
      note: 'the page calls its circular and ForceAtlas2 layouts only, synchronously; its Web Worker layout is never started, and the CSP would block it',
    },
  },
]);

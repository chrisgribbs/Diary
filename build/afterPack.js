// Sets the Windows .exe icon and version info without needing Wine.
const path = require('path');
const fs = require('fs');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const PELibrary = await import('pe-library');
  const R = ResEdit.default || ResEdit, P = PELibrary.default || PELibrary;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const exeData = P.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = P.NtExecutableResource.from(exeData);
  const ico = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
  for (const g of groups) {
    R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, ico.icons.map(i => i.data));
  }
  const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0];
  const v = ctx.packager.appInfo.version.split('.').map(Number);
  vi.setFileVersion(v[0], v[1], v[2], 0, 1033);
  vi.setProductVersion(v[0], v[1], v[2], 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'Daybook', ProductName: 'Daybook', CompanyName: 'Daybook',
    InternalName: 'Daybook', OriginalFilename: 'Daybook.exe', LegalCopyright: ctx.packager.appInfo.copyright,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exeData);
  fs.writeFileSync(exe, Buffer.from(exeData.generate()));
  console.log('  • set icon and version info on', path.basename(exe));
};

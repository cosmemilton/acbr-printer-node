// Rebuild the freely available libxml2 Windows DLL on Linux/WSL with MinGW.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const version='2.15.4';
const expected='98087fd181d9070724f3fbc65c7377db03038eb92bd882374daff44940138821';
const url=`https://download.gnome.org/sources/libxml2/2.15/libxml2-${version}.tar.xz`;
const argv=process.argv.slice(2); let archiveInput;
if(argv.length){if(argv.length!==2||argv[0]!=='--archive')throw Error('Uso: node scripts/build-libxml2.mjs [--archive FILE]');archiveInput=resolve(argv[1]);}
if(process.platform!=='linux')throw Error('Execute esta receita no Linux/WSL com MinGW-w64, cmake, ninja, curl e tar.');
const work=join(root,'.deps/native/libxml2-'+version);
const output=join(root,'.deps/windows-libraries');
await mkdir(work,{recursive:true});await mkdir(output,{recursive:true});
const logs=[];
function run(command,args,cwd=work){
  const result=spawnSync(command,args,{cwd,shell:false,encoding:'utf8',maxBuffer:32*1024*1024,timeout:300000,
    env:{...process.env,SOURCE_DATE_EPOCH:'0',LC_ALL:'C',TZ:'UTC'}});
  logs.push({command,args,cwd,stdout:result.stdout??'',stderr:result.stderr??''});
  if(result.error||result.status!==0)throw Error(`${command} falhou: ${result.error?.message??''}\n${(result.stderr??result.stdout??'').slice(-10000)}`);
  return result.stdout;
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const archive=join(work,`libxml2-${version}.tar.xz`);
try{
  if(archiveInput)await copyFile(archiveInput,archive);
  else {try{await access(archive);}catch{run('curl',['--fail','--location','--silent','--show-error','--retry','3','--output',archive,url]);}}
  if(digest(await readFile(archive))!==expected)throw Error('SHA-256 do fonte libxml2 divergente.');
  run('tar',['-xf',archive,'-C',work]);
  const source=join(work,`libxml2-${version}`), build=join(work,'build'),install=join(work,'install');
  const toolchain=join(work,'mingw.cmake');
  await writeFile(toolchain,'set(CMAKE_SYSTEM_NAME Windows)\nset(CMAKE_SYSTEM_PROCESSOR x86_64)\nset(CMAKE_C_COMPILER x86_64-w64-mingw32-gcc-win32)\nset(CMAKE_RC_COMPILER x86_64-w64-mingw32-windres)\n');
  console.log('Compilando libxml2 '+version+' para Windows x64 (MinGW)...');
  run('cmake',['-S',source,'-B',build,'-G','Ninja','-DCMAKE_TOOLCHAIN_FILE='+toolchain,
    '-DCMAKE_BUILD_TYPE=Release','-DCMAKE_INSTALL_PREFIX='+install,'-DCMAKE_C_FLAGS=-static-libgcc',
    '-DCMAKE_SHARED_LINKER_FLAGS=-static-libgcc -Wl,--no-insert-timestamp',
    '-DBUILD_SHARED_LIBS=ON','-DLIBXML2_WITH_ICONV=OFF','-DLIBXML2_WITH_ICU=OFF','-DLIBXML2_WITH_ZLIB=OFF',
    '-DLIBXML2_WITH_PYTHON=OFF','-DLIBXML2_WITH_PROGRAMS=OFF','-DLIBXML2_WITH_TESTS=OFF',
    '-DLIBXML2_WITH_SCHEMAS=ON','-DLIBXML2_WITH_C14N=ON','-DLIBXML2_WITH_THREADS=ON',
    '-DLIBXML2_WITH_LEGACY=OFF','-DLIBXML2_WITH_HTTP=OFF']);
  run('cmake',['--build',build,'--parallel','4']);run('cmake',['--install',build]);
  const dll=join(install,'bin/libxml2.dll');
  const table=run('x86_64-w64-mingw32-objdump',['-p',dll]);
  if(!table.includes('pei-x86-64'))throw Error('A DLL produzida não é PE x64.');
  const imports=[...table.matchAll(/DLL Name:\s*(\S+)/g)].map(match=>match[1].toLowerCase());
  const system=new Set(['kernel32.dll','msvcrt.dll','ws2_32.dll','bcrypt.dll','advapi32.dll','user32.dll','ntdll.dll']);
  if(imports.some(name=>!system.has(name)))throw Error('DLL com dependência não distribuída: '+imports.join(', '));
  for(const symbol of ['xmlReadMemory','xmlFreeDoc','xmlSchemaParse','xmlSchemaValidateDoc','xmlC14NDocDumpMemory']){
    if(!new RegExp('\\]\\s+'+symbol+'(?:\\s|$)').test(table))throw Error('Export obrigatório ausente: '+symbol);
  }
  await copyFile(dll,join(output,'libxml2.dll'));
  await copyFile(join(source,'Copyright'),join(output,'libxml2.dll.LICENSE'));
  await copyFile('/usr/share/doc/gcc-13/copyright',join(output,'GCC-Runtime.LICENSE'));
  await copyFile('/usr/share/common-licenses/GPL-3',join(output,'GCC-GPL-3.LICENSE'));
  await copyFile('/usr/share/doc/mingw-w64-common/copyright',join(output,'MinGW-w64.LICENSE'));
  const manifest={formatVersion:1,name:'libxml2',version,url,sourceSha256:expected,platform:'win32',arch:'x64',
    dllSha256:digest(await readFile(dll)),imports,compiler:run('x86_64-w64-mingw32-gcc-win32',['--version']).split('\n')[0],
    note:'Recompilação MinGW; sem MSVC/Delphi ou dependência do pacote fiscal. Testes nativos no Windows são separados.'};
  await writeFile(join(output,'SOURCE.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log('DLL e licenças preservadas em '+output);
}finally{await writeFile(join(work,'build.log'),logs.map(entry=>JSON.stringify({command:entry.command,args:entry.args,cwd:entry.cwd})+'\n'+entry.stdout+entry.stderr).join('\n'));}

/**
 * [INPUT]: Main-owned frozen compile request and the offline transform kernel.
 * [OUTPUT]: One complete plugin candidate or a bounded diagnostic; no arbitrary package script runs.
 * [POS]: Self-contained bundled Node entry, started only under the engineering Seatbelt supervisor.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {compileUnifiedPlugin} from './kernel';
async function main(){
  const [request,result]=process.argv.slice(2);
  try{
    if(!request||!result)throw new Error('PLUGIN_COMPILER_REQUEST_REQUIRED');
    await writeFile(result,JSON.stringify(await compileUnifiedPlugin(JSON.parse(await readFile(request,'utf8')))),{mode:0o600});
  }catch(error){process.stderr.write(String(error).slice(0,8192)+'\n');process.exitCode=1;}
}
void main();

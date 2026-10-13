import {readFile} from 'node:fs/promises';
import ts from 'typescript';
export async function loadBrowserModule(path,{replace=source=>source,id=''}={}){
  const source=await readFile(new URL('../../'+path,import.meta.url),'utf8');
  const code=ts.transpileModule(replace(source),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import('data:text/javascript;base64,'+Buffer.from(code+'\n// '+id).toString('base64'));
}
export function memoryStorage(){
  const data=new Map();
  return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
}

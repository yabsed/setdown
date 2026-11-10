import type * as M from 'monaco-editor';
import type { LanguageApi } from '../../protocol/language';
import { languageDefinition } from '../../core/document/language-catalog';

const tokenTypes = ['namespace','type','class','enum','interface','struct','typeParameter','parameter','variable','property','enumMember','event','function','method','macro','keyword','modifier','comment','string','number','regexp','operator','decorator'];
const aliases: Record<string,string> = { constant:'enumMember',constructor:'function',tag:'type',attribute:'property',boolean:'keyword',punctuation:'operator',label:'namespace',embedded:'string' };
const bindings = new WeakMap<M.editor.ITextModel,{file:string;port:LanguageApi}>();
const registered = new WeakMap<typeof M,Set<string>>();

export function bindTreeSitter(api: typeof M, model: M.editor.ITextModel, file: string, port: LanguageApi): void {
  const definition = languageDefinition(model.getLanguageId());
  if (definition?.grammar || !definition?.treeSitter || !port.highlight) return;
  bindings.set(model,{file,port});
  const ids = registered.get(api) ?? new Set(); registered.set(api,ids);
  const id = model.getLanguageId(); if (ids.has(id)) return; ids.add(id);
  api.languages.registerDocumentSemanticTokensProvider(id,{
    getLegend:()=>({tokenTypes,tokenModifiers:[]}),
    releaseDocumentSemanticTokens() {},
    async provideDocumentSemanticTokens(model,_last,token) {
      const binding = bindings.get(model); if (!binding?.port.highlight || model.getValueLength()>2*1024*1024) return null;
      const version = model.getVersionId(), language = model.getLanguageId();
      const spans = await binding.port.highlight(binding.file,language,model.getValue());
      if (token.isCancellationRequested || model.isDisposed() || model.getVersionId()!==version || model.getLanguageId()!==language || bindings.get(model)!==binding) return null;
      const segments = syntaxSegments(spans);
      const data:number[]=[]; let previousLine=0,previousStart=0;
      for (const [start,end,type] of segments) {
        const from=model.getPositionAt(start),to=model.getPositionAt(end);
        for(let line=from.lineNumber;line<=to.lineNumber;line++) {
          const column=line===from.lineNumber?from.column:1;
          const limit=line===to.lineNumber?to.column:model.getLineMaxColumn(line);
          if(limit<=column)continue;
          const row=line-1,col=column-1;
          data.push(row-previousLine,row===previousLine?col-previousStart:col,limit-column,type,0);
          previousLine=row;previousStart=col;
        }
      }
      return {data:Uint32Array.from(data)};
    },
  });
}

/** Flatten overlapping query captures. Narrower inner captures win without overlapping tokens. */
export function syntaxSegments(spans: Array<[number,number,string]>): Array<[number,number,number]> {
  const events = spans.flatMap(([start,end,name],index) => {
    const root=name.split('.')[0], type=tokenTypes.indexOf(aliases[root]??root);
    return start<end && type>=0 ? [{offset:start,index,start,end,type,open:true},{offset:end,index,start,end,type,open:false}] : [];
  }).sort((a,b)=>a.offset-b.offset || Number(a.open)-Number(b.open));
  const active=new Map<number,typeof events[number]>(),result:Array<[number,number,number]>=[];
  let offset=0;
  for(const event of events) {
    if(event.offset>offset && active.size) {
      const winner=[...active.values()].sort((a,b)=>(a.end-a.start)-(b.end-b.start)||b.index-a.index)[0];
      const previous=result.at(-1);
      if(previous?.[1]===offset && previous[2]===winner.type)previous[1]=event.offset;
      else result.push([offset,event.offset,winner.type]);
    }
    if(event.open)active.set(event.index,event);else active.delete(event.index);
    offset=event.offset;
  }
  return result;
}

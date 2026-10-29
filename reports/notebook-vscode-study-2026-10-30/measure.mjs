// Browser-side measurement. Range rectangles establish actual line breaks.
export function measureTable() {
  const table=document.querySelector('table.dataframe');
  if (!table) throw new Error('Missing DataFrame');
  const cssNames=['fontFamily','fontSize','fontWeight','lineHeight','overflowWrap','wordBreak','whiteSpace','textAlign','verticalAlign','paddingTop','paddingRight','borderTopWidth','borderTopStyle','backgroundColor','tableLayout'];
  const info=el=>({tag:el.tagName,classes:el.className,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,css:Object.fromEntries(cssNames.map(k=>[k,getComputedStyle(el)[k]]))});
  const lines=el=>{
    const grouped=new Map(),walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode;
      for(let i=0;i<node.textContent.length;i++){
        const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);
        const rect=range.getBoundingClientRect(); if(!rect.width)continue;
        const y=Math.round(rect.top*10)/10;grouped.set(y,(grouped.get(y)||'')+node.textContent[i]);
      }
    }
    return [...grouped.values()].map(s=>s.trim()).filter(Boolean);
  };
  const ancestors=[];for(let el=table.parentElement;el&&ancestors.length<5;el=el.parentElement)ancestors.push(info(el));
  return {table:info(table),ancestors,rows:[...table.rows].map(row=>({height:row.getBoundingClientRect().height,cells:[...row.cells].map(c=>({...info(c),text:c.textContent.trim(),lines:lines(c)}))})), authoredStyles:table.parentElement.querySelectorAll('style').length, borderAttribute:table.getAttribute('border'), userAgent:navigator.userAgent,devicePixelRatio:window.devicePixelRatio};
}

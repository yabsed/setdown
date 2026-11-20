# Counts the user-interface contributions of the VS Code extensions vendored under vendor/.
# Run from anywhere: python3 -I reports/language-ui-design-2026-11-21/manifest-count.py (needs rg).
# Counts of API calls are call sites in non-test TypeScript, not how often something appears.
import json,sys,os,re,subprocess,collections
R=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','vendor')+'/'
EXT=[('Python (MS)','vscode-python','package.json','src/client'),
('Python Environments','vscode-python-environments','package.json','src'),
('Pyright','pyright','packages/vscode-pyright/package.json','packages/vscode-pyright/src'),
('Java (Red Hat)','vscode-java','package.json','src'),
('Go','vscode-go','extension/package.json','extension/src'),
('rust-analyzer','rust-analyzer','editors/code/package.json','editors/code/src'),
('clangd','vscode-clangd','package.json','src'),
('C/C++ (MS)','vscode-cpptools','Extension/package.json','Extension/src'),
('Svelte','svelte-language-tools','packages/svelte-vscode/package.json','packages/svelte-vscode/src'),
('Intelephense','vscode-intelephense','package.json','src'),
('YAML','vscode-yaml','package.json','src'),
('TypeScript (built-in)','vscode','extensions/typescript-language-features/package.json','extensions/typescript-language-features/src'),
('JSON (built-in)','vscode','extensions/json-language-features/package.json','extensions/json-language-features/client/src'),
('HTML (built-in)','vscode','extensions/html-language-features/package.json','extensions/html-language-features/client/src'),
('CSS (built-in)','vscode','extensions/css-language-features/package.json','extensions/css-language-features/client/src'),
]
def props(cfg):
    if isinstance(cfg,dict): cfg=[cfg]
    n=0
    for c in cfg or []: n+=len((c or {}).get('properties',{}))
    return n
API={'status':r'createStatusBarItem\(','langStatus':r'createLanguageStatusItem\(','info':r'show(Information)Message\(','warn':r'showWarningMessage\(','error':r'showErrorMessage\(',
 'quickPick':r'(showQuickPick|createQuickPick)\(','input':r'(showInputBox|createInputBox)\(','webview':r'(createWebviewPanel|registerWebviewViewProvider|registerCustomEditorProvider)\(','tree':r'(createTreeView|registerTreeDataProvider)\(','output':r'createOutputChannel\(','progress':r'withProgress\(','decoration':r'createTextEditorDecorationType\(','terminal':r'createTerminal\('}
rows=[]
for name,repo,man,src in EXT:
    p=R+repo+'/'+man
    if not os.path.exists(p): rows.append((name,'MISSING '+p)); continue
    c=json.load(open(p)).get('contributes',{})
    cmds=c.get('commands',[]); menus=c.get('menus',{})
    ids={x['command'] for x in cmds}; pal=menus.get('commandPalette',[])
    hidden=len({m['command'] for m in pal if str(m.get('when','')).strip()=='false'}&ids)
    cond=len(({m['command'] for m in pal if str(m.get('when','')).strip() not in('','false')}&ids)-{m['command'] for m in pal if str(m.get('when','')).strip()=='false'})
    place={k:len(v) for k,v in menus.items() if k!='commandPalette'}
    views=sum(len(v) for v in c.get('views',{}).values()); vc=sum(len(v) for v in c.get('viewsContainers',{}).values())
    wt=c.get('walkthroughs',[]); steps=sum(len(w.get('steps',[])) for w in wt)
    d=dict(name=name,commands=len(cmds),hidden=hidden,conditional=cond,always=len(cmds)-hidden-cond,settings=props(c.get('configuration')),keys=len(c.get('keybindings',[])),views=views,containers=vc,walk=f"{len(wt)}/{steps}",menus=place,submenus=len(c.get('submenus',[])),debuggers=len(c.get('debuggers',[])),tasks=len(c.get('taskDefinitions',[])))
    sp=R+repo+'/'+src
    for k,rx in API.items():
        try:
            out=subprocess.run(['rg','-c','--no-messages','-g','*.ts','-g','*.tsx','-g','!**/test/**','-g','!**/*.test.ts','-g','!**/tests/**','-g','!**/*.unit.test.ts',rx,sp],capture_output=True,text=True).stdout
            d[k]=sum(int(l.rsplit(':',1)[1]) for l in out.splitlines() if ':' in l)
        except Exception as e: d[k]='?'
    rows.append(d)
h=['name','commands','always','conditional','hidden','settings','keys','views','containers','walk','submenus','debuggers','tasks']
print(' | '.join(h))
for d in rows:
    if isinstance(d,tuple): print(d); continue
    print(' | '.join(str(d[k]) for k in h))
print()
h2=['name']+list(API)
print(' | '.join(h2))
for d in rows:
    if isinstance(d,tuple): continue
    print(' | '.join(str(d[k]) for k in h2))
print()
for d in rows:
    if isinstance(d,tuple): continue
    print(d['name'],'menus:',', '.join(f"{k}={v}" for k,v in sorted(d['menus'].items(),key=lambda x:-x[1])))

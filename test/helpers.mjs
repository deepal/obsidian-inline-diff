import { build } from "esbuild";
import { JSDOM } from "jsdom";

const shim = `
export class Component {
 constructor(){this.cleanups=[];this.children=[];this.loaded=false;}
 register(callback){this.cleanups.push(callback);}
 registerDomEvent(el,type,handler,options){el.addEventListener(type,handler,options);this.register(()=>el.removeEventListener(type,handler,options));}
 addChild(child){this.children.push(child);if(this.loaded)child.load();return child;}
 removeChild(child){this.children=this.children.filter(c=>c!==child);child.unload();return child;}
 load(){this.loaded=true;this.onload?.();for(const child of this.children)child.load();}
 unload(){for(const child of this.children)child.unload();this.children=[];for(const cleanup of this.cleanups.splice(0))cleanup();this.onunload?.();this.loaded=false;}
}
export class PluginSettingTab {}
export class Scope { register() {} }
export class MarkdownRenderChild extends Component {constructor(el){super();this.containerEl=el;}}
export class MarkdownView {}
export class Notice { constructor(message) { globalThis.__notices?.push(message); } }
export const editorInfoField = {}, editorLivePreviewField = {};
export const MarkdownRenderer={async render(app,md,el,path,owner){if(globalThis.__renderGate)await globalThis.__renderGate;el.innerHTML=md;}};
export function setIcon(el,icon){el.innerHTML='<svg data-icon="'+icon+'"></svg>';}
export function setTooltip(el,text){el.title=text;}
`;

export async function importHostModule(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false,
    plugins: [{ name: "host", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
      builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: shim, loader: "js" }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

export function dom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  const win = dom.window;
  Object.defineProperty(win.Document.prototype, "win", { get() { return win; } });
  win.createSpan = () => win.document.createElement("span");
  win.ResizeObserver = class { observe() {} disconnect() {} };
  Object.defineProperty(win.HTMLElement.prototype, "win", { get() { return win; } });
  win.HTMLElement.prototype.setCssProps = function(values) { for (const [name, value] of Object.entries(values)) this.style.setProperty(name, value); };
  win.HTMLElement.prototype.setCssStyles = function(values) { Object.assign(this.style, values); };
  for (const [method, tag] of [["createDiv", "div"], ["createSpan", "span"]]) win.HTMLElement.prototype[method] = function(options = {}) { return this.createEl(tag, options); };
  win.HTMLElement.prototype.createEl = function(tag, options = {}) {
    const el = this.ownerDocument.createElement(tag);
    if (options.cls) el.className = options.cls;
    if (options.text) el.textContent = options.text;
    this.append(el); return el;
  };
  return dom;
}

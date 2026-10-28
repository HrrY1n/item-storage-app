// Synthetic fixture imports the actual production components; it never opens a business database.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import ItemPanel, { useItemPanel } from '/src/components/ItemPanel'
import ModalSheet from '/src/components/ModalSheet'
import '/src/index.css'

const host = createRoot(document.getElementById('fixture')!)
let props = { mode: 'panel', open: true, ready: true, path: '/items/synthetic-a' }
let exits = 0
let nextFrame = 0
const frames = new Map<number, FrameRequestCallback>()
const controlled = new URLSearchParams(location.search).has('controlled')
if (controlled) {
  window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame }
  window.cancelAnimationFrame = id => { frames.delete(id) }
}
const close = () => patch({ open: false })
function Content() {
  const { entering } = useItemPanel(close, props.ready)
  return props.ready && !entering
    ? <div data-content={props.path}><h1>{props.path}</h1><div style={{height: 2400}}>合成内容</div></div>
    : <p role="status">正在载入合成内容…</p>
}
function draw() {
  flushSync(() => host.render(<StrictMode>{props.mode === 'panel'
    ? <ItemPanel path={props.path} open={props.open} onExited={() => { exits++ }}><Content /></ItemPanel>
    : <ModalSheet open={props.open} label="合成选择器" onClose={close} onExited={() => { exits++ }} variant="picker"><p>合成内容</p></ModalSheet>
  }</StrictMode>))
}
function patch(update: Partial<typeof props>) { props = {...props, ...update}; draw() }
window.fixture = {
  mount(mode = 'panel', ready = true) { props = {mode, ready, open: true, path: '/items/synthetic-a'}; exits = 0; draw() },
  patch,
  unmount() { flushSync(() => host.render(null)) },
  step() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(performance.now())) },
  snapshot() { return {pendingFrames: frames.size, exits, dialog: !!document.querySelector('dialog[open]'),
    content: document.querySelector('[data-content]')?.getAttribute('data-content'), overflow: document.body.style.overflow} },
}

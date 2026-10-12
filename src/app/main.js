import demoPhoto from '../../assets/photos/yellow-clouds.jpg'
import { Editor, DEFAULTS } from '../core/editor.js'
import { exportGif, renderOne } from '../core/export.js'
import { GIF, gifSize } from '../core/gif.js'
import { readPhoto, readPhotoUrl } from '../core/photo.js'
import { WebGLUnavailable } from '../core/renderer.js'
import { DEMO } from './demo.js'
import { Stage } from './stage.js'
import { initTheme } from './theme.js'
import { createToast } from './toast.js'

const $ = (id) => document.getElementById(id)
const toast = createToast($('toast'))
const editor = new Editor()

const HELP = {
  arrow: 'Drag on the photo. The picture flows the way the arrow points. Drag an end to adjust it.',
  paint: 'Paint over what should stay still: a boat, a face, a sign.',
  erase: 'Paint over a frozen area to let it move again.',
}

let stage
try {
  stage = new Stage({
    area: $('stage-area'),
    stage: $('stage'),
    canvas: $('view'),
    tint: $('tint'),
    overlay: $('arrows'),
    cursor: $('brush-cursor'),
    editor,
    toast,
  })
} catch (error) {
  if (!(error instanceof WebGLUnavailable)) throw error
  const unsupported = $('unsupported')
  unsupported.hidden = false
  document.body.replaceChildren(unsupported)
}

if (stage) boot()

async function boot() {
  let photoName = 'clouds'
  initTheme($('theme'))
  bindTools()
  bindSliders()
  bindArrows()
  bindHold()
  bindPlayback()
  bindHistory()
  bindFiles()
  bindDownload()

  const photo = await readPhotoUrl(demoPhoto)
  stage.setPhoto(photo)
  editor.load(DEMO)
  describePhoto(photo)
  $('stage').classList.remove('loading-photo')

  window.oohalive = {
    editor,
    stage,
    preview: (phase) => stage.snapshot(phase),
    frame(phase, size = { width: stage.photo.width, height: stage.photo.height }) {
      const rgba = renderOne({ photo: stage.photo, freeze: stage.mask.mask, params: editor.params, size, phase })
      return { ...size, rgba }
    },
  }
  document.documentElement.dataset.ready = 'true'

  function describePhoto(source) {
    const { width, height } = gifSize(source.width, source.height)
    $('photo-info').textContent = `${source.width} × ${source.height}`
    $('gif-meta').textContent = `${width} × ${height} · ${GIF.frames} frames · ${1000 / GIF.delayMs} fps · loops forever`
  }

  function bindTools() {
    const apply = (tool) => {
      document.body.classList.remove('tool-arrow', 'tool-paint', 'tool-erase')
      document.body.classList.add(`tool-${tool}`)
      $('tool-help').textContent = HELP[tool]
      stage.setTool(tool)
    }
    for (const input of document.querySelectorAll('input[name=tool]')) {
      input.addEventListener('change', () => apply(input.value))
    }
    apply('arrow')
  }

  function bindSliders() {
    const specs = {
      radius: (v) => `${Math.round(v * 100)}% of height`,
      speed: (v) => `${(v / DEFAULTS.speed).toFixed(1)}×`,
      brush: (v) => `${Math.round(v * 200)}% of height`,
    }
    const paint = (name) => {
      const input = $(name)
      const span = Number(input.max) - Number(input.min)
      input.style.setProperty('--fill', `${((editor[name] - Number(input.min)) / span) * 100}%`)
      input.value = editor[name]
      $(`out-${name}`).textContent = specs[name](editor[name])
    }
    for (const name of Object.keys(specs)) {
      paint(name)
      $(name).addEventListener('input', (event) => {
        editor.setParam(name, Number(event.target.value))
        paint(name)
        if (name === 'radius') stage.showReach()
      })
    }
  }

  function bindArrows() {
    const list = $('chips')
    const draw = () => {
      list.replaceChildren()
      if (!editor.arrows.length) {
        const none = Object.assign(document.createElement('li'), { className: 'empty', textContent: 'None yet. Drag on the photo.' })
        list.append(none)
      }
      editor.arrows.forEach((arrow, index) => {
        const item = document.createElement('li')
        item.classList.toggle('selected', arrow.id === stage.selectedId)
        item.append(`Arrow ${index + 1}`)
        const remove = Object.assign(document.createElement('button'), {
          type: 'button',
          textContent: '×',
          ariaLabel: `Remove arrow ${index + 1}`,
        })
        remove.addEventListener('click', () => {
          editor.beginAction()
          editor.removeArrow(arrow.id)
        })
        item.append(remove)
        list.append(item)
      })
      $('arrow-count').textContent = `${editor.arrows.length} of 6`
    }
    stage.addEventListener('arrows', draw)
    stage.addEventListener('select', draw)
    stage.addEventListener('draw', () => $('hint').classList.add('gone'))
    draw()
  }

  function bindHold() {
    const button = $('hold')
    const hold = (on) => {
      stage.setOriginal(on)
      button.classList.toggle('is-held', on)
    }
    button.addEventListener('pointerdown', (event) => {
      button.setPointerCapture(event.pointerId)
      hold(true)
    })
    for (const type of ['pointerup', 'pointercancel']) button.addEventListener(type, () => hold(false))
    button.addEventListener('contextmenu', (event) => event.preventDefault())
    button.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        hold(true)
      }
    })
    button.addEventListener('keyup', () => hold(false))
    const typing = (event) => event.target instanceof HTMLInputElement && event.target.type !== 'radio' && event.target.type !== 'range'
    addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'o' && !event.repeat && !event.metaKey && !event.ctrlKey && !typing(event)) hold(true)
    })
    addEventListener('keyup', (event) => {
      if (event.key.toLowerCase() === 'o') hold(false)
    })
    addEventListener('blur', () => hold(false))
  }

  function bindPlayback() {
    const button = $('play')
    const set = (playing) => {
      stage.setPlaying(playing)
      button.setAttribute('aria-pressed', String(playing))
      button.querySelector('span').textContent = playing ? 'Pause' : 'Play'
    }
    button.addEventListener('click', () => set(!stage.playing))
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stage.restAtPeak()
      set(false)
    }
  }

  function bindHistory() {
    const undo = $('undo')
    const update = () => {
      undo.disabled = !editor.canUndo
    }
    editor.on(update)
    update()
    undo.addEventListener('click', () => editor.undo())
    $('reset').addEventListener('click', () => {
      editor.reset()
      toast('Back to the start. Undo brings your edits back.')
    })
    addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        editor.undo()
      }
    })
  }

  function bindFiles() {
    let latest = 0
    const load = async (file) => {
      if (!file) return
      const mine = ++latest
      $('stage').classList.add('loading-photo')
      try {
        const next = await readPhoto(file)
        if (mine !== latest) return
        photoName = file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 40) || 'photo'
        stage.setPhoto(next)
        editor.load({})
        describePhoto(next)
        $('hint').classList.remove('gone')
      } catch {
        if (mine === latest) toast("That file didn't open. Try a JPG, PNG or WebP photo.")
      } finally {
        if (mine === latest) $('stage').classList.remove('loading-photo')
      }
    }
    $('open').addEventListener('click', () => $('file').click())
    $('file').addEventListener('change', (event) => {
      load(event.target.files[0])
      event.target.value = ''
    })
    let depth = 0
    const area = $('stage-area')
    const hasFile = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files')
    addEventListener('dragenter', (event) => {
      if (!hasFile(event)) return
      depth++
      area.classList.add('dropping')
    })
    addEventListener('dragover', (event) => hasFile(event) && event.preventDefault())
    addEventListener('dragleave', (event) => {
      if (!hasFile(event)) return
      depth = Math.max(0, depth - 1)
      if (!depth) area.classList.remove('dropping')
    })
    addEventListener('drop', (event) => {
      if (!hasFile(event)) return
      event.preventDefault()
      depth = 0
      area.classList.remove('dropping')
      load([...event.dataTransfer.files].find((f) => f.type.startsWith('image/')))
    })
    addEventListener('paste', (event) => load([...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))))
    stage.loadFile = load
  }

  function bindDownload() {
    const button = $('download')
    const label = $('download-label')
    let busy = false
    button.addEventListener('click', async () => {
      if (busy) return
      busy = true
      button.setAttribute('aria-busy', 'true')
      try {
        const blob = await exportGif({
          photo: stage.photo,
          freeze: stage.mask.mask,
          params: editor.params,
          onProgress: (done) => {
            $('fill').style.width = `${Math.round(done * 100)}%`
            label.textContent = `Making your GIF ${Math.round(done * 100)}%`
          },
        })
        const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${photoName}-alive.gif` })
        link.click()
        setTimeout(() => URL.revokeObjectURL(link.href), 15000)
        toast(`Saved ${link.download}, ${(blob.size / 1e6).toFixed(1)} MB. It loops forever.`)
      } catch {
        toast("The GIF couldn't be made. Reload the page and try again.")
      } finally {
        busy = false
        button.removeAttribute('aria-busy')
        label.textContent = 'Download GIF'
        $('fill').style.width = '0'
      }
    })
  }
}

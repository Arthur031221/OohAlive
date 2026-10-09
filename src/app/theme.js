const KEY = 'oohalive-theme'

function current() {
  return document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
}

export function initTheme(button) {
  button.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // Private mode or file access without storage: the choice just lasts for this visit.
    }
  })
}
